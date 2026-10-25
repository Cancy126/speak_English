from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, utcnow

CONVERSATION_STATUS = ("active", "completed", "archived")


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    # Learner-chosen label; falls back to topic/scene when empty (产品规划 3.4.2).
    title: Mapped[str | None] = mapped_column(String(60), nullable=True)
    topic: Mapped[str | None] = mapped_column(String(120), nullable=True)
    scene: Mapped[str | None] = mapped_column(String(60), nullable=True)
    # Education mode: the unit this conversation practises (产品规划 3.6). SET NULL on
    # delete — removing a unit must not erase the history that practised it.
    unit_id: Mapped[int | None] = mapped_column(
        ForeignKey("units.id", ondelete="SET NULL"), nullable=True, index=True
    )
    status: Mapped[str] = mapped_column(String(20), default="active")
    # Soft delete. `status` cannot stand in for it: it carries no timestamp, so a
    # 7-day recovery window and the purge job would be uncomputable.
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    user = relationship("User", back_populates="conversations")
    messages = relationship(
        "Message", back_populates="conversation", cascade="all, delete-orphan"
    )
