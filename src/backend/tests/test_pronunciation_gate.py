"""Attempt-validity gate and alignment normalisation (产品规划 3.2.7).

These cover the two real-recording failures the gate was built for, plus the
case-sensitivity bug that was inflating every WER before it. Pure functions on a
Hypothesis: no model weights, no DB, no LLM call.
"""

from app.services.pronunciation_service import (
    MIN_SPEECH_MS,
    REJECT_NOT_READ,
    REJECT_SILENT,
    pronunciation_service,
)
from app.services.whisper_service import Hypothesis, SpokenWord

ORDER = "Are you ready to order, or just saying hi first?"


def take(words: list[str], duration: float, start: float = 0.0, step: float = 0.45) -> Hypothesis:
    items = []
    clock = start
    for w in words:
        items.append(SpokenWord(word=w, start=clock, end=clock + 0.4, confidence=0.95))
        clock += step
    return Hypothesis(text=" ".join(words), duration=duration, words=items)


def metrics(hyp: Hypothesis, reference: str) -> dict:
    _words, m = pronunciation_service.score_words(reference, hyp.words)
    return m


class TestAlignmentNormalisation:
    def test_sentence_capitalisation_is_not_misread(self):
        """Whisper lowercases; a perfect read must not be penalised for 'Are' vs 'are'.

        Before normalisation this case scored WER 20% / accuracy 80 — one fabricated
        error on the first word of every capitalised sentence.
        """
        hyp = take(["are", "you", "ready", "to", "order?"], duration=3.0)
        _words, m = pronunciation_service.score_words("Are you ready to order?", hyp.words)
        assert m["wer"] == 0.0
        assert m["accuracy"] == 100.0
        assert m["alignment"] == 1.0

    def test_display_keeps_the_reference_casing(self):
        hyp = take(["are", "you"], duration=1.2)
        words, _m = pronunciation_service.score_words("Are you", hyp.words)
        assert [w.word for w in words] == ["Are", "you"]


class TestSilenceProtection:
    def test_long_take_that_is_mostly_silence_is_rejected(self):
        """The measured case: 12.06s of audio containing 0.7s of 'Hello?'."""
        hyp = Hypothesis(
            text="Hello?",
            duration=12.06,
            words=[SpokenWord(word="Hello?", start=6.42, end=7.12, confidence=0.95)],
        )
        result = pronunciation_service.assess_attempt(hyp, metrics(hyp, ORDER))
        assert result is not None
        assert result.reject_code == REJECT_SILENT
        assert result.attempt_ok is False

    def test_transcript_with_no_words_is_rejected(self):
        result = pronunciation_service.assess_attempt(Hypothesis(text="", duration=4.0, words=[]))
        assert result is not None
        assert result.reject_code == REJECT_SILENT

    def test_rejection_withholds_scores_instead_of_scoring_zero(self):
        """`available` describes the engine; `attempt_ok` describes the take."""
        result = pronunciation_service.assess_attempt(Hypothesis(text="", duration=9.0, words=[]))
        assert result is not None
        assert result.available is True
        assert result.attempt_ok is False
        assert result.overall == 0.0

    def test_short_but_real_reply_is_still_scored(self):
        """'Hello?' inside 2.8s is a genuine turn — the gate must not eat it.

        The measured file: 1.7s of speech in 2.8s of audio (60%). Same words as the
        silent take above, so only the span separates them.
        """
        hyp = Hypothesis(
            text="Hello?",
            duration=2.82,
            words=[SpokenWord(word="Hello?", start=0.4, end=2.1, confidence=0.95)],
        )
        assert hyp.words[-1].end - hyp.words[0].start >= MIN_SPEECH_MS / 1000
        assert pronunciation_service.assess_attempt(hyp) is None

    def test_ratio_gate_ignores_short_takes(self):
        """A 2s take cannot be judged for 'mostly silence' — only long ones."""
        hyp = take(["yes", "i", "would"], duration=2.0, step=0.5)
        assert pronunciation_service.assess_attempt(hyp) is None


class TestReadAloudTolerance:
    def test_saying_something_else_is_rejected(self):
        """The measured 8.76s take: a fluent sentence that is not the reference."""
        hyp = take(
            ["hey", "there", "are", "some", "things", "about", "your", "head", "with", "others"],
            duration=8.76,
        )
        result = pronunciation_service.assess_attempt(hyp, metrics(hyp, ORDER))
        assert result is not None
        assert result.reject_code == REJECT_NOT_READ

    def test_majority_read_of_the_sentence_is_scored(self):
        """Most of the sentence recognised: judge the pronunciation, do not bounce it."""
        hyp = take(["are", "you", "ready", "to", "order", "or"], duration=3.4)
        m = metrics(hyp, ORDER)
        assert m["alignment"] == 0.6
        assert pronunciation_service.assess_attempt(hyp, m) is None

    def test_reading_only_the_opening_falls_below_the_threshold(self):
        """0.4 alignment sits under the calibrated 0.5 cut-off.

        Documented on purpose: real attempts measured 0.52-1.00, off-topic ones
        0.00-0.46, so the boundary is deliberately close to the observed gap —
        a learner who abandons the sentence mid-way gets bounced rather than graded.
        """
        hyp = take(["are", "you", "ready", "to"], duration=3.2)
        m = metrics(hyp, ORDER)
        assert m["alignment"] == 0.4
        result = pronunciation_service.assess_attempt(hyp, m)
        assert result is not None
        assert result.reject_code == REJECT_NOT_READ

    def test_accented_read_with_substitutions_is_scored(self):
        hyp = take(
            ["are", "you", "ready", "to", "order", "or", "just", "saying", "hi", "first"],
            duration=6.5,
        )
        assert pronunciation_service.assess_attempt(hyp, metrics(hyp, ORDER)) is None

    def test_note_tells_the_learner_what_was_heard(self):
        hyp = take(["no", "thanks"], duration=2.0, step=0.6)
        result = pronunciation_service.assess_attempt(hyp, metrics(hyp, ORDER))
        assert result is not None
        assert "no thanks" in (result.note or "")

    def test_free_mode_never_uses_the_alignment_gate(self):
        """No reference exists, so a low alignment cannot condemn the take."""
        hyp = take(["i", "went", "out", "yesterday", "evening"], duration=3.5)
        assert pronunciation_service.assess_attempt(hyp) is None
