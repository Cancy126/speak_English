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
_TOKEN = re.compile(r"[A-Za-z']+")


def tokenize(text: str) -> list[str]:
    return _TOKEN.findall(text or "")


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
        hyp_tokens = [tokenize(w.word)[0] if tokenize(w.word) else "" for w in heard]
        hyp_pairs = list(zip(hyp_tokens, heard))
        hyp_pairs = [(t, w) for t, w in hyp_pairs if t]
        hyp_tokens = [t for t, _ in hyp_pairs]

        matcher = SequenceMatcher(None, ref, hyp_tokens)
        words: list[WordScore] = []
        deletes = inserts = replaces = 0

        for tag, i1, i2, j1, j2 in matcher.get_opcodes():
            if tag == "equal":
                for k in range(i2 - i1):
                    rw, (hw, wobj) = ref[i1 + k], hyp_pairs[j1 + k]
                    conf = max(0.0, min(1.0, wobj.confidence))
                    words.append(WordScore(
                        word=rw, score=round(conf * 100, 1), status="matched",
                        expected_ipa=self._ipa(rw),
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
                    hw, wobj = hyp_pairs[hyp_span[k]]
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
        """Transcribe then align. Raises on missing weights or decode failure."""
        hyp = await whisper_service.transcribe(audio_path)
        words, m = self.score_words(reference_text, hyp.words)

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
