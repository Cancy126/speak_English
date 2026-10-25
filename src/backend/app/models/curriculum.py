from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, utcnow

# Textbook volumes are written the way a Chinese teacher reads them; the units are
# named after the textbook's own 单元 titles, so admins can enter what they see in the
# book instead of translating to a code first.
VOLUMES = ("上册", "下册")


class Textbook(Base):
    """A concrete textbook the admin uploads words for: 出版社 + 年级 + 上下册."""

    __tablename__ = "textbooks"
    __table_args__ = (UniqueConstraint("publisher", "grade", "volume", name="uq_textbook_level"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    publisher: Mapped[str] = mapped_column(String(60))
    grade: Mapped[str] = mapped_column(String(20))
    volume: Mapped[str] = mapped_column(String(10))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    units = relationship(
        "Unit", back_populates="textbook", cascade="all, delete-orphan", order_by="Unit.position"
    )


class Unit(Base):
    """One 单元 of a textbook: the unit a child practises, and the word list that bounds it."""

    __tablename__ = "units"

    id: Mapped[int] = mapped_column(primary_key=True)
    textbook_id: Mapped[int] = mapped_column(
        ForeignKey("textbooks.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(120))
    position: Mapped[int] = mapped_column(Integer, default=0)
    # What the unit teaches, in the teacher's words ("问路与交通工具"). Injected into the
    # prompt as the conversation's goal; empty means "just stay inside the word list".
    focus: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    textbook = relationship("Textbook", back_populates="units")
    words = relationship(
        "UnitWord", back_populates="unit", cascade="all, delete-orphan", order_by="UnitWord.position"
    )


class UnitWord(Base):
    """A word the learner is expected to know in this unit — the ceiling for AI replies."""

    __tablename__ = "unit_words"
    __table_args__ = (UniqueConstraint("unit_id", "word", name="uq_unit_word"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    unit_id: Mapped[int] = mapped_column(ForeignKey("units.id", ondelete="CASCADE"), index=True)
    word: Mapped[str] = mapped_column(String(64))
    meaning_zh: Mapped[str] = mapped_column(String(120))
    example: Mapped[str | None] = mapped_column(String(255), nullable=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    unit = relationship("Unit", back_populates="words")


class UnitProgress(Base):
    """Per-learner position and mastery, so the child resumes where they stopped."""

    __tablename__ = "unit_progress"
    __table_args__ = (UniqueConstraint("user_id", "unit_id", name="uq_user_unit_progress"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    unit_id: Mapped[int] = mapped_column(ForeignKey("units.id", ondelete="CASCADE"), index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    # Highest judged score ever reached in this unit. Rejected takes never reach here
    # (3.2.7 writes no score row), so a bounced attempt cannot lower mastery.
    best_overall: Mapped[float | None] = mapped_column(Float, nullable=True)
    completed: Mapped[bool] = mapped_column(Boolean, default=False)
    last_practiced_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
