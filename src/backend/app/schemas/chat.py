from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ConversationCreate(BaseModel):
    topic: str | None = Field(default=None, max_length=120)
    scene: str | None = Field(default=None, max_length=60)


class ConversationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
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
