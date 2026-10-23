from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, utcnow

SCORE_MODES = ("read_aloud", "free")


class PronunciationScore(Base):
    """One row per evaluation, so scores survive a refresh and can trend later.

    Before this table existed the ScoreCard was computed, returned, and dropped.
    """

    __tablename__ = "pronunciation_scores"

    id: Mapped[int] = mapped_column(primary_key=True)
    # A score is tied to a message and, when present, to the stored recording.
    message_id: Mapped[int] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"), index=True
    )
    audio_asset_id: Mapped[int | None] = mapped_column(
        ForeignKey("audio_assets.id", ondelete="SET NULL"), nullable=True
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    mode: Mapped[str] = mapped_column(String(16), default="read_aloud")
    reference_text: Mapped[str] = mapped_column(Text)
    heard_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Word-level detail (status / score / expected_ipa); phonemes stay empty until GOP.
    words_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    accuracy: Mapped[float | None] = mapped_column(Float, nullable=True)
    fluency: Mapped[float | None] = mapped_column(Float, nullable=True)
    completeness: Mapped[float | None] = mapped_column(Float, nullable=True)
    overall: Mapped[float] = mapped_column(Float, default=0.0)
    wer: Mapped[float | None] = mapped_column(Float, nullable=True)
    # NULL for free speech, which has no reference and therefore no pronunciation score.
    pron_engine_available: Mapped[int | None] = mapped_column(Integer)
    engine: Mapped[str] = mapped_column(String(60), default="none")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    message = relationship("Message", back_populates="scores")
