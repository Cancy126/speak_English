from datetime import datetime

from pydantic import BaseModel, Field


class PhonemeScore(BaseModel):
    phoneme: str
    expected_ipa: str
    score: float = Field(ge=0, le=100)
    status: str = Field(description="good | near | wrong")
    syllable: str | None = None


class WordScore(BaseModel):
    word: str
    score: float = Field(ge=0, le=100)
    # matched | substituted | missing — from aligning the transcript to the reference
    status: str = "matched"
    expected_ipa: str | None = None
    heard_as: str | None = None
    start: float | None = None
    end: float | None = None
    phonemes: list[PhonemeScore] = []


class PronunciationResult(BaseModel):
    accuracy: float = Field(ge=0, le=100)
    fluency: float = Field(ge=0, le=100)
    completeness: float = Field(ge=0, le=100)
    overall: float = Field(ge=0, le=100)
    words: list[WordScore] = []
    # engine id, so the UI can show which model produced this. "unavailable" =
    # Phase 2 engine not loaded yet; the recording is still stored and scored
    # on the text side, so the UI can be finished before the model lands.
    engine: str = "unavailable"
    available: bool = False
    note: str | None = None
    # What the STT engine actually heard, for  heard-vs-reference comparison.
    transcript: str | None = None
    wer: float | None = None
    # False when the take itself cannot be judged: silence, or words that are not
    # the reference sentence. The engine worked (`available` stays true) — there is
    # just no meaningful pronunciation score, so the UI must show `note` instead of
    # a number. Never persist these as scored rows (产品规划 3.2.7).
    attempt_ok: bool = True
    # silent | not_read_aloud — stable code for the frontend to branch on.
    reject_code: str | None = None


class ContentScore(BaseModel):
    vocabulary_range: float = Field(ge=0, le=100)
    sentence_diversity: float = Field(ge=0, le=100)
    nativeness: float = Field(ge=0, le=100)
    notes: list[str] = []


class ScoreCard(BaseModel):
    pronunciation: PronunciationResult
    content: ContentScore | None = None
    audio_bytes: int = 0
    audio_asset_id: int | None = None
    # Set once the evaluation is persisted; the UI keys its collapsed card on this.
    score_id: int | None = None
    # read_aloud has a reference sentence and can score pronunciation; free cannot.
    mode: str = "read_aloud"


class ScoreRecordOut(BaseModel):
    """A stored evaluation, replayed so scores survive a refresh (3.2.5)."""

    id: int
    message_id: int
    audio_asset_id: int | None
    mode: str
    reference_text: str
    heard_text: str | None
    accuracy: float | None
    fluency: float | None
    completeness: float | None
    overall: float
    wer: float | None
    engine: str
    created_at: datetime
    words: list[WordScore] = []
