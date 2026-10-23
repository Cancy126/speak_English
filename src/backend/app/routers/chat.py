import json

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.dependencies import get_current_user
from app.db.base import utcnow
from app.db.session import async_session_factory, get_db
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.user import User
from app.schemas.chat import (
    ChatReply,
    ConversationCreate,
    ConversationOut,
    MessageCreate,
    MessageOut,
    TopicOut,
)
from app.services.ai_service import HISTORY_WINDOW, TOPICS, AIServiceError, ai_service
from app.services.tts_service import tts_service

router = APIRouter(prefix="/api/chat", tags=["chat"])


@router.get("/topics", response_model=list[TopicOut])
async def topics() -> list[TopicOut]:
    """Interest bubbles + random-button pool for the landing page."""
    return [TopicOut(**t) for t in TOPICS]


@router.post("/conversations", response_model=ConversationOut, status_code=status.HTTP_201_CREATED)
async def create_conversation(
    body: ConversationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Conversation:
    conversation = Conversation(user_id=current_user.id, topic=body.topic, scene=body.scene)
    db.add(conversation)
    await db.flush()
    await db.refresh(conversation)
    return conversation


@router.get("/conversations", response_model=list[ConversationOut])
async def list_conversations(
    limit: int = Query(30, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[Conversation]:
    result = await db.execute(
        select(Conversation)
        .where(Conversation.user_id == current_user.id, Conversation.deleted_at.is_(None))
        .order_by(Conversation.updated_at.desc())
        .limit(limit)
    )
    return list(result.scalars().all())


# Declared before /conversations/{conversation_id} on purpose: FastAPI matches in
# registration order, so a later definition would let "trash" be captured by the
# int path param and fail with 422 instead of listing the recycle bin.
@router.get("/conversations/trash", response_model=list[ConversationOut])
async def list_trash(
    limit: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[Conversation]:
    result = await db.execute(
        select(Conversation)
        .where(Conversation.user_id == current_user.id, Conversation.deleted_at.is_not(None))
        .order_by(Conversation.deleted_at.desc())
        .limit(limit)
    )
    return list(result.scalars().all())


@router.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation(
    conversation_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Soft delete: rows and audio stay for TRASH_RETENTION_DAYS so it can be undone."""
    conversation = await _owned_conversation(conversation_id, db, current_user)
    conversation.deleted_at = utcnow()
    await db.flush()


@router.post("/conversations/{conversation_id}/restore", response_model=ConversationOut)
async def restore_conversation(
    conversation_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Conversation:
    conversation = await _owned_conversation(conversation_id, db, current_user, allow_deleted=True)
    conversation.deleted_at = None
    await db.flush()
    await db.refresh(conversation)
    return conversation


@router.get("/conversations/{conversation_id}", response_model=ConversationOut)
async def get_conversation(
    conversation_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Conversation:
    return await _owned_conversation(conversation_id, db, current_user)


@router.get("/conversations/{conversation_id}/messages", response_model=list[MessageOut])
async def list_messages(
    conversation_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[Message]:
    await _owned_conversation(conversation_id, db, current_user)
    result = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.sequence.asc())
    )
    return list(result.scalars().all())


@router.post("/conversations/{conversation_id}/messages", response_model=ChatReply)
async def send_message(
    conversation_id: int,
    body: MessageCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ChatReply:
    """Full round trip in one request. Prefer /stream for a faster first token."""
    conversation = await _owned_conversation(conversation_id, db, current_user)
    history = await _history(db, conversation.id)

    user_msg = await _append(db, conversation, current_user, "user", body.content)
    try:
        reply_text = await _collect(history, body.content, conversation)
    except AIServiceError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    assistant_msg = await _append(db, conversation, current_user, "assistant", reply_text)
    await _attach_feedback(db, assistant_msg, body.content)
    await db.flush()
    await db.refresh(assistant_msg)

    return ChatReply(
        user_message=MessageOut.model_validate(user_msg),
        assistant_message=MessageOut.model_validate(assistant_msg),
        tts_url=await tts_service.synthesize(reply_text),
    )


@router.post("/conversations/{conversation_id}/stream")
async def stream_message(
    conversation_id: int,
    body: MessageCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StreamingResponse:
    """SSE over POST: `delta` events while generating, then `done` or `error`.

    The learner's turn is committed before streaming begins, so a dropped
    connection still keeps their message in the archive. The assistant turn is
    written on a separate session because the request session closes as soon as
    this handler returns, while the generator keeps running.
    """
    conversation = await _owned_conversation(conversation_id, db, current_user)
    history = await _history(db, conversation.id)
    user_msg = await _append(db, conversation, current_user, "user", body.content)
    await db.commit()

    conv_id = conversation.id
    user_id = current_user.id
    # Free-expression scoring attaches the recording to the learner's own turn, so
    # the client needs this id back; it only has the assistant id from `done`.
    user_message_id = user_msg.id
    topic, scene = conversation.topic, conversation.scene

    async def event_stream():
        collected: list[str] = []
        try:
            async for delta in ai_service.stream_chat(history, body.content, topic, scene):
                collected.append(delta)
                yield _sse("delta", {"text": delta})
        except AIServiceError as exc:
            yield _sse("error", {"detail": str(exc)})
            return

        text = "".join(collected).strip()
        async with async_session_factory() as write_db:
            assistant = await _append_raw(write_db, conv_id, user_id, "assistant", text)
            feedback = await ai_service.feedback(body.content)
            if feedback:
                assistant.feedback = json.dumps(feedback, ensure_ascii=False)
            await write_db.commit()
            message_id = assistant.id

        yield _sse("done", {"message_id": message_id, "user_message_id": user_message_id})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def _collect(history: list[dict], content: str, conversation: Conversation) -> str:
    parts: list[str] = []
    async for delta in ai_service.stream_chat(
        history, content, conversation.topic, conversation.scene
    ):
        parts.append(delta)
    text = "".join(parts).strip()
    if not text:
        raise AIServiceError("LLM returned an empty reply")
    return text


async def _attach_feedback(db: AsyncSession, message: Message, learner_content: str) -> None:
    feedback = await ai_service.feedback(learner_content)
    if feedback:
        message.feedback = json.dumps(feedback, ensure_ascii=False)


async def _append(
    db: AsyncSession, conversation: Conversation, user: User, role: str, content: str
) -> Message:
    return await _append_raw(db, conversation.id, user.id, role, content)


async def _append_raw(
    db: AsyncSession, conversation_id: int, user_id: int, role: str, content: str
) -> Message:
    seq = await db.scalar(
        select(Message.sequence)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.sequence.desc())
        .limit(1)
    )
    msg = Message(
        conversation_id=conversation_id,
        user_id=user_id,
        role=role,
        content=content,
        sequence=(seq or 0) + 1,
    )
    db.add(msg)
    await db.flush()
    await db.refresh(msg)
    return msg


async def _history(db: AsyncSession, conversation_id: int) -> list[dict]:
    result = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.sequence.desc())
        .limit(HISTORY_WINDOW)
    )
    rows = list(result.scalars().all())[::-1]
    return [{"role": m.role, "content": m.content} for m in rows if m.role in ("user", "assistant")]


async def _owned_conversation(
    conversation_id: int,
    db: AsyncSession,
    user: User,
    allow_deleted: bool = False,
) -> Conversation:
    """Fetch a conversation the caller owns.

    Trashed ones read as missing by default: without this a soft-deleted
    conversation would still open, still list its messages, and still accept new
    turns, so "delete" would hide nothing that mattered.
    """
    query = select(Conversation).where(
        Conversation.id == conversation_id, Conversation.user_id == user.id
    )
    if not allow_deleted:
        query = query.where(Conversation.deleted_at.is_(None))
    result = await db.execute(query.options(selectinload(Conversation.messages)))
    conversation = result.scalars().first()
    if conversation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    return conversation
