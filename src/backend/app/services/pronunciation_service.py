import logging
import re
from difflib import SequenceMatcher
from pathlib import Path

from app.config import settings
from app.schemas.pronunciation import ContentScore, PronunciationResult, WordScore
from app.services.whisper_service import whisper_service

logger = logging.getLogger(__name__)

ENGINE = settings.PRONUNCIATION_ENGINE

try:  # IPA is a display extra; scoring must keep working if it is unavailable.
    # NB: `eng_to_ipa.__all__` claims an `en_to_ipa` symbol that does not exist;
    # the real callable is convert() in the transcribe submodule.
    from eng_to_ipa.transcribe import convert as _en_to_ipa
except ImportError as _ipa_exc:  # pragma: no cover
    _en_to_ipa = None
    logger.warning("IPA display disabled: %s", _ipa_exc)

# Expected speaking rate for the fluency ratio, words per second. A learner read
# at ~2.8 wps scores 100; slower than that is scaled down linearly.
FLUENCY_TARGET_WPS = 2.8

# Attempt validity gates (产品规划 3.2.7). Calibrated against the ten real browser
# recordings on disk rather than guessed: silence takes measured 0.7s of speech
# inside 12.1s of audio (6%), while the shortest genuine attempt was 1.7s/2.8s (60%),
# and off-topic read-alouds landed at 0.43 alignment versus 0.52-1.00 for real ones.
MIN_SPEECH_MS = 800        # first-to-last word span; below this nothing was said
MIN_SPEECH_RATIO = 0.15    # ... or the take is mostly silence inside a long recording
MIN_LONG_TAKE_MS = 4000    # ratio gate only applies to takes long enough to be judged
MIN_READ_ALIGNMENT = 0.5   # read-aloud: share of the reference actually recognised

# Stable codes the UI branches on; the human text lives in `PronunciationResult.note`.
REJECT_SILENT = "silent"
REJECT_NOT_READ = "not_read_aloud"

_TOKEN = re.compile(r"[A-Za-z']+")


def tokenize(text: str) -> list[str]:
    return _TOKEN.findall(text or "")


def _norm(token: str) -> str:
    """Comparison key for a token.

    Whisper emits lowercase text while references are written as sentences
    ("Are you ready..."), so an unnormalised compare marked every sentence-initial
    word as misread: a perfect read of a 5-word reference scored WER 20% on a
    capital-A. Display still uses the reference's own casing.
    """
    return token.lower().rstrip("'")


class PronunciationService:
    """Word-level pronunciation scoring on top of server-side STT.

    Method: transcribe the learner's recording with faster-whisper (word
    timestamps + per-word confidence), align the transcript against the
    reference sentence, and derive accuracy / completeness / fluency from the
    alignment.

    Honest limits: per-word `confidence` is an ASR measure, not an acoustic
    pronunciation measurement, so it is a proxy — a word can be heard correctly
    yet pronounced badly. Phoneme-level GOP needs a phone CTC model and is not
    done here; `phonemes` stays empty and the UI must not invent scores for it.
    """

    def __init__(self, engine: str = ENGINE) -> None:
        self.engine = engine
        self.model_dir = Path(settings.WHISPER_MODEL_DIR)

    @property
    def available(self) -> bool:
        # Weights on disk, not "already loaded" — the model lazy-loads on the
        # first recording, so gating on in-memory state would skip scoring forever.
        return self.engine == "faster-whisper" and whisper_service.weights_ready

    def load(self) -> None:
        """Report weight readiness at startup; the model itself lazy-loads.

        Deliberately not loading here: keeping ~336MB resident on a 2-core 4GB
        box for a feature that is used occasionally is the wrong trade, and a
        fire-and-forget warm-up task can be garbage collected mid-load.
        """
        if self.engine != "faster-whisper":
            logger.info("Pronunciation engine disabled (PRONUNCIATION_ENGINE=%s)", self.engine)
            return
        missing = whisper_service.missing_files()
        if missing:
            logger.warning(
                "faster-whisper weights incomplete (%s) in %s — /score degrades to content-only",
                ", ".join(missing), whisper_service.model_dir,
            )
        else:
            logger.info("faster-whisper weights present at %s (loads on first recording)", self.model_dir)

    def _ipa(self, word: str) -> str | None:
        if _en_to_ipa is None or not word:
            return None
        try:
            out = _en_to_ipa(word)
            return out.strip() or None
        except Exception as exc:  # noqa: BLE001 — display only, never fail a score for it
            logger.debug("IPA lookup failed for %r: %s", word, exc)
            return None

    def score_words(self, reference: str, heard: list) -> tuple[list[WordScore], dict]:
        """Align reference tokens to transcript words. Returns per-word scores + metrics."""
        ref = tokenize(reference)
        # Compare on normalised keys, display the reference's own casing: Whisper
        # lowercases while references are written as sentences.
        ref_keys = [_norm(t) for t in ref]
        hyp_pairs = []
        for w in heard:
            tokens = tokenize(w.word)
            if tokens:
                hyp_pairs.append((_norm(tokens[0]), tokens[0], w))
        hyp_keys = [k for k, _, _ in hyp_pairs]

        matcher = SequenceMatcher(None, ref_keys, hyp_keys)
        words: list[WordScore] = []
        deletes = inserts = replaces = matched = 0

        for tag, i1, i2, j1, j2 in matcher.get_opcodes():
            if tag == "equal":
                matched += i2 - i1
                for k in range(i2 - i1):
                    rw, (hw, _, wobj) = ref[i1 + k], hyp_pairs[j1 + k]
                    conf = max(0.0, min(1.0, wobj.confidence))
                    words.append(WordScore(
                        word=rw, score=round(conf * 100, 1), status="matched",
                        expected_ipa=self._ipa(rw), heard_as=hw,
                        start=round(wobj.start, 2), end=round(wobj.end, 2),
                    ))
            elif tag == "replace":
                ref_span = list(range(i1, i2))
                hyp_span = list(range(j1, j2))
                pairs = min(len(ref_span), len(hyp_span))
                replaces += pairs
                # Surplus reference words read as extra speech count as insertions;
                # surplus heard words are insertions too.
                inserts += max(0, len(hyp_span) - pairs)
                deletes += max(0, len(ref_span) - pairs)
                for k in range(pairs):
                    rw = ref[ref_span[k]]
                    _, hw, wobj = hyp_pairs[hyp_span[k]]
                    conf = max(0.0, min(1.0, wobj.confidence))
                    words.append(WordScore(
                        word=rw, score=round(min(conf * 100, 45.0), 1), status="substituted",
                        expected_ipa=self._ipa(rw), heard_as=hw,
                        start=round(wobj.start, 2), end=round(wobj.end, 2),
                    ))
                for idx in ref_span[pairs:]:
                    words.append(WordScore(
                        word=ref[idx], score=0.0, status="missing",
                        expected_ipa=self._ipa(ref[idx]),
                    ))
            elif tag == "delete":
                deletes += i2 - i1
                for k in range(i1, i2):
                    words.append(WordScore(
                        word=ref[k], score=0.0, status="missing",
                        expected_ipa=self._ipa(ref[k]),
                    ))
            elif tag == "insert":
                inserts += j2 - j1

        ref_n = len(ref) or 1
        wer = (deletes + inserts + replaces) / ref_n
        accuracy = max(0.0, min(100.0, 100.0 * (1.0 - wer)))
        completeness = max(0.0, min(100.0, 100.0 * (len(ref) - deletes) / ref_n))
        return words, {
            "accuracy": round(accuracy, 1),
            "completeness": round(completeness, 1),
            "wer": round(wer * 100, 1),
            # Share of the reference actually recognised in the right place — the
            # number the read-aloud tolerance gate below judges attempts by.
            "alignment": round(matched / ref_n, 3),
            "ref_words": len(ref),
            "matched": matched,
            "deletes": deletes, "inserts": inserts, "replaces": replaces,
        }

    def fluency(self, spoken_words: int, duration: float, gaps: list[float]) -> float:
        if duration <= 0 or spoken_words <= 0:
            return 0.0
        rate = spoken_words / duration
        score = 100.0 * min(1.0, rate / FLUENCY_TARGET_WPS)
        # Penalise long mid-sentence pauses (a hesitation marker in speaking tests).
        long_gaps = sum(1 for g in gaps if g > 1.0)
        score -= long_gaps * 8.0
        return round(max(0.0, min(100.0, score)), 1)

    def _rejected(self, code: str, note: str, hyp=None) -> PronunciationResult:
        """A take that cannot be judged. Scores stay at zero *and* `attempt_ok=False`,
        so no caller can mistake the absence of a score for a score of zero."""
        return PronunciationResult(
            accuracy=0.0,
            fluency=0.0,
            completeness=0.0,
            overall=0.0,
            words=[],
            engine=f"faster-whisper:{self.model_dir.name}",
            available=True,
            note=note,
            transcript=(hyp.text or None) if hyp is not None else None,
            wer=None,
            attempt_ok=False,
            reject_code=code,
        )

    def assess_attempt(self, hyp, m: dict | None = None) -> PronunciationResult | None:
        """Gate takes that carry nothing to score. Returns None when scorable.

        Both thresholds come from the real recordings on disk, not from intuition:
        - a 12.06s take that only said 'Hello?' measured 0.7s of speech (6% of the
          take) yet still scored a low-but-real-looking number; genuine attempts
          measured 1.7-11.5s of speech at 51-93%.
        - read-aloud takes that were not the reference sentence aligned at 0.00 and
          0.43 against the same sentence, while real reads aligned 0.52-1.00.
          Scoring those as "bad pronunciation" taught the learner the wrong thing:
          the metric conflated "did not read this" with "read it badly".
        """
        words = getattr(hyp, "words", None) or []
        duration = float(getattr(hyp, "duration", 0.0) or 0.0)
        span = (words[-1].end - words[0].start) if words else 0.0

        if not words or span * 1000 < MIN_SPEECH_MS:
            heard = (hyp.text or "").strip()
            return self._rejected(
                REJECT_SILENT,
                "没听到有效语音（说话不足 "
                f"{MIN_SPEECH_MS / 1000:.1f} 秒），本次不评发音"
                + (f"。听到的是：'{heard}'" if heard else "。请靠近麦克风，把整句完整读一遍"),
                hyp,
            )

        if duration * 1000 >= MIN_LONG_TAKE_MS and span / duration < MIN_SPEECH_RATIO:
            return self._rejected(
                REJECT_SILENT,
                f"录音 {duration:.1f} 秒里只有 {span:.1f} 秒是说话（{span / duration:.0%}），"
                "其余是静音，本次不评发音。请完整录下你要练的那句",
                hyp,
            )

        if m is not None and m.get("alignment") is not None:
            if m["alignment"] < MIN_READ_ALIGNMENT:
                return self._rejected(
                    REJECT_NOT_READ,
                    f"没有按要求跟读：参考句 {m['ref_words']} 个词里只对上 "
                    f"{m['matched']} 个（{m['alignment']:.0%}），分数无法反映发音好坏。"
                    f"听到的是：'{(hyp.text or '').strip()}' —— 请先听一遍标准音，再照着原句重读",
                    hyp,
                )
        return None

    def score_free(self, hyp) -> PronunciationResult:
        """Score a free-spoken recording, where no reference sentence exists.

        Without a target sentence there is no WER, so the axes mean something
        narrower and the note says so:

        - accuracy   = mean ASR word confidence. A proxy for clarity of speech —
          mumbled or clipped words transcribe less confidently — not a phoneme measurement.
        - completeness = share of the recording covered by transcribed speech, i.e.
          how little of the take was silence.
        - fluency    = speaking rate plus long-pause penalty, same as read-aloud.
        """
        rejected = self.assess_attempt(hyp)
        if rejected is not None:
            return rejected

        words: list[WordScore] = []
        confs: list[float] = []
        for w in hyp.words:
            tokens = tokenize(w.word)
            if not tokens:
                continue
            conf = max(0.0, min(1.0, w.confidence))
            score = round(conf * 100, 1)
            words.append(WordScore(
                word=tokens[0], score=score,
                status="unclear" if conf < 0.6 else "matched",
                expected_ipa=self._ipa(tokens[0]),
                start=round(w.start, 2), end=round(w.end, 2),
            ))
            confs.append(conf)

        duration = float(getattr(hyp, "duration", 0.0) or 0.0)
        speech_span = sum(max(0.0, w.end - w.start) for w in hyp.words)
        accuracy = round(sum(confs) / len(confs) * 100, 1) if confs else 0.0
        completeness = round(min(100.0, 100.0 * speech_span / duration), 1) if duration > 0 else 0.0
        fl = self.fluency(len(hyp.words), duration,
                          [max(0.0, c.start - p.end) for p, c in zip(hyp.words, hyp.words[1:])])
        overall = round(0.5 * accuracy + 0.25 * completeness + 0.25 * fl, 1)

        return PronunciationResult(
            accuracy=accuracy,
            fluency=fl,
            completeness=completeness,
            overall=overall,
            words=words,
            engine=f"faster-whisper:{self.model_dir.name}",
            available=True,
            transcript=hyp.text,
            # No target sentence, so a word error rate is undefined, not zero.
            wer=None,
            note=(
                "自由表达无对照句，不计算 WER 与漏读/错读。发音分取自 ASR 逐词置信度，"
                "是清晰度代理指标（吞音、含糊会拉低），不等于音素级准确度。"
            ),
        )

    async def score(self, audio_path: Path, reference_text: str) -> PronunciationResult:
        """Transcribe, gate the take, then align. Raises on missing weights or decode failure."""
        hyp = await whisper_service.transcribe(audio_path)
        words, m = self.score_words(reference_text, hyp.words)

        rejected = self.assess_attempt(hyp, m)
        if rejected is not None:
            return rejected

        gaps: list[float] = []
        for prev, cur in zip(hyp.words, hyp.words[1:]):
            gaps.append(max(0.0, cur.start - prev.end))

        fl = self.fluency(len(hyp.words), hyp.duration, gaps)
        overall = round(0.5 * m["accuracy"] + 0.25 * m["completeness"] + 0.25 * fl, 1)

        return PronunciationResult(
            accuracy=m["accuracy"],
            fluency=fl,
            completeness=m["completeness"],
            overall=overall,
            words=words,
            engine=f"faster-whisper:{self.model_dir.name}",
            available=True,
            transcript=hyp.text,
            wer=m["wer"],
            note=(
                f"词级评测：以 ASR 转写与参考句对齐得出（WER {m['wer']}%）。"
                "单词分数来自识别置信度，是发音的代理指标；音素级 GOP 待后续接入。"
            ),
        )

    async def content_score(self, transcript: str) -> ContentScore:
        """Lexical/syntactic score from text only — no model, no cost."""
        words = tokenize(transcript)
        unique = set(w.lower() for w in words)
        asl = sum(len(w) for w in words) / len(unique) if unique else 0.0
        variety = len(unique) / len(words) if words else 0.0
        return ContentScore(
            vocabulary_range=round(min(100.0, variety * 130), 1),
            sentence_diversity=round(min(100.0, asl * 18), 1),
            nativeness=round(min(100.0, len(words) * 1.4), 1),
            notes=[] if words else ["Say a bit more so I can score your expression."],
        )


pronunciation_service = PronunciationService()
