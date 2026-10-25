from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


def _clean_title(value: str) -> str:
    """Trim first, then let min_length judge the result.

    Validating the raw string lets "  " through `min_length=1`, and a later
    `.strip()` in the route would then persist an empty name — a blank click
    could erase a conversation's title.
    """
    value = value.strip()
    if not value:
        raise ValueError("title cannot be blank")
    return value


class ConversationCreate(BaseModel):
    topic: str | None = Field(default=None, max_length=120)
    scene: str | None = Field(default=None, max_length=60)
    # Learner's own label; wins over topic/scene when listing (产品规划 3.4.2).
    title: str | None = Field(default=None, min_length=1, max_length=60)

    @field_validator("title")
    @classmethod
    def _trim_title(cls, value: str | None) -> str | None:
        return None if value is None else _clean_title(value)


class ConversationRename(BaseModel):
    title: str = Field(min_length=1, max_length=60)

    @field_validator("title")
    @classmethod
    def _trim_title(cls, value: str) -> str:
        return _clean_title(value)


class ConversationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str | None
    topic: str | None
    scene: str | None
    status: str
    created_at: datetime
    updated_at: datetime
    # Non-null while the conversation sits in the trash and can still be restored.
    deleted_at: datetime | None = None


class MessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=8000)
    # true when the content came from browser STT rather than typing
    from_voice: bool = False


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    conversation_id: int
    role: str
    content: str
    feedback: str | None
    sequence: int
    created_at: datetime


class ChatReply(BaseModel):
    """Non-streaming response shape (used when SSE is not desired)."""

    user_message: MessageOut
    assistant_message: MessageOut
    tts_url: str | None = None


class TopicOut(BaseModel):
    key: str
    label: str
    emoji: str
    opener: str
