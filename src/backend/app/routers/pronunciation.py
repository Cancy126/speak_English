import json
import logging
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user
from app.db.session import get_db
from app.models.audio_asset import AudioAsset
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.pronunciation_score import PronunciationScore
from app.models.user import User
from app.schemas.pronunciation import (
    ContentScore,
    PronunciationResult,
    ScoreCard,
    ScoreRecordOut,
    WordScore,
)
from app.services.pronunciation_service import pronunciation_service
from app.services.storage_service import StorageService
from app.services.whisper_service import whisper_service

router = APIRouter(prefix="/api/pronunciation", tags=["pronunciation"])
logger = logging.getLogger(__name__)

MAX_BYTES = 10 * 1024 * 1024


def _degrade_reason() -> str:
    """Tell a disabled engine apart from missing weights; both look the same upstream."""
    if pronunciation_service.engine != "faster-whisper":
        return (
            f"发音评测已停用（PRONUNCIATION_ENGINE={pronunciation_service.engine}），"
            "本次仅给出内容评分"
        )
    return (
        f"未找到 faster-whisper 权重（缺 {', '.join(whisper_service.missing_files()) or '?'}，"
        f"期望目录 {whisper_service.model_dir}），本次仅给出内容评分"
    )


@router.post("/score", response_model=ScoreCard)
async def score(
    audio: UploadFile = File(...),
    reference_text: str = Form(...),
    message_id: int = Form(...),
    mode: str = Form(default="read_aloud", pattern="^(read_aloud|free)$"),
    duration_ms: int | None = Form(default=None, ge=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ScoreCard:
    """Store the learner's recording and score what can actually be scored.

    `mode` decides what is measurable, and the response never fakes the rest:

    - `read_aloud`: the recording is judged against `reference_text`, so
      accuracy / completeness / per-word status come from aligning the transcript.
    - `free`: the learner said their own thing, so there is nothing to align to.
      Pronunciation accuracy is *not computable* (the transcript is our own ASR
      output — scoring it would be circular), hence `available=false` and only a
      content score. The UI must show "未评发音", never a zero.
    """
    payload = await audio.read()
    if not payload:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty audio upload")
    if len(payload) > MAX_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            detail="Audio exceeds 10MB")

    # The recording must hang off a message this user owns; otherwise any client
    # could attach files to someone else's conversation.
    owned = await db.execute(
        select(Message.id)
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(Message.id == message_id, Conversation.user_id == current_user.id)
    )
    if owned.scalars().first() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")

    storage = StorageService()
    suffix = (audio.filename or "recording.webm").rsplit(".", 1)[-1] or "webm"
    # Unique per upload: re-recording the same message must not overwrite the
    # first take while its audio_assets row still points at the same path.
    filename = f"user-{current_user.id}-{message_id}-{uuid4().hex[:8]}.{suffix}"
    rel = storage.save_bytes(filename, payload)

    asset = AudioAsset(
        message_id=message_id,
        user_id=current_user.id,
        kind="user_recording",
        file_path=rel,
        duration_ms=duration_ms,
    )
    db.add(asset)
    await db.flush()

    content = await pronunciation_service.content_score(reference_text)

    if mode == "free":
        # Transcribe here rather than trusting a client-supplied transcript, so the
        # content score and the pronunciation proxy describe the same hearing.
        try:
            hyp = await whisper_service.transcribe(storage.absolute_path(rel))
            free_result = pronunciation_service.score_free(hyp)
        except Exception as exc:  # noqa: BLE001 — keep the upload, degrade the score
            logger.warning("free-expression scoring failed for asset %s: %s", asset.id, exc)
            free_result = PronunciationResult(
                accuracy=0, fluency=0, completeness=0, overall=0,
                engine=pronunciation_service.engine, available=False,
                note=f"自由表达评测失败，本次仅存录音：{type(exc).__name__}: {str(exc)[:140]}",
            )
            content = await pronunciation_service.content_score(reference_text)
            return ScoreCard(
                pronunciation=free_result, content=content,
                audio_bytes=len(payload), audio_asset_id=asset.id, mode="free",
            )

        content = await pronunciation_service.content_score(hyp.text)
        free_record = PronunciationScore(
            message_id=message_id,
            audio_asset_id=asset.id,
            user_id=current_user.id,
            mode="free",
            reference_text=hyp.text,
            heard_text=hyp.text,
            words_json=json.dumps(
                [w.model_dump() for w in free_result.words], ensure_ascii=False, default=str
            ),
            accuracy=free_result.accuracy,
            fluency=free_result.fluency,
            completeness=free_result.completeness,
            overall=free_result.overall,
            wer=None,
            pron_engine_available=1,
            engine=free_result.engine,
        )
        db.add(free_record)
        await db.flush()
        return ScoreCard(
            pronunciation=free_result,
            content=content,
            audio_bytes=len(payload),
            audio_asset_id=asset.id,
            score_id=free_record.id,
            mode="free",
        )

    if not pronunciation_service.available:
        return ScoreCard(
            pronunciation=PronunciationResult(
                accuracy=0, fluency=0, completeness=0, overall=0,
                engine=pronunciation_service.engine,
                available=False,
                note=_degrade_reason(),
            ),
            content=content,
            audio_bytes=len(payload),
            audio_asset_id=asset.id,
        )

    try:
        result = await pronunciation_service.score(storage.absolute_path(rel), reference_text)
    except Exception as exc:  # noqa: BLE001 — decode/inference failure must not lose the upload
        logger.warning("word-level scoring failed for asset %s: %s", asset.id, exc)
        return ScoreCard(
            pronunciation=PronunciationResult(
                accuracy=0, fluency=0, completeness=0, overall=0,
                engine=pronunciation_service.engine,
                available=False,
                note=f"词级评测执行失败，本次仅给出内容评分：{type(exc).__name__}: {str(exc)[:160]}",
            ),
            content=content,
            audio_bytes=len(payload),
            audio_asset_id=asset.id,
        )

    # Persist only real evaluations. Degraded/failed paths above return early, so
    # no all-zero rows pollute later averages or trends.
    record = PronunciationScore(
        message_id=message_id,
        audio_asset_id=asset.id,
        user_id=current_user.id,
        mode="read_aloud",
        reference_text=reference_text,
        heard_text=result.transcript,
        words_json=json.dumps(
            [w.model_dump() for w in result.words], ensure_ascii=False, default=str
        ),
        accuracy=result.accuracy,
        fluency=result.fluency,
        completeness=result.completeness,
        overall=result.overall,
        wer=result.wer,
        pron_engine_available=1,
        engine=result.engine,
    )
    db.add(record)
    await db.flush()

    return ScoreCard(
        pronunciation=result,
        content=content,
        audio_bytes=len(payload),
        audio_asset_id=asset.id,
        score_id=record.id,
    )


async def _to_records(rows: list[PronunciationScore]) -> list[ScoreRecordOut]:
    out: list[ScoreRecordOut] = []
    for row in rows:
        try:
            words = [WordScore(**w) for w in json.loads(row.words_json or "[]")]
        except (json.JSONDecodeError, TypeError, ValueError):
            # A row written by an older schema version must not break the list.
            words = []
        out.append(
            ScoreRecordOut(
                id=row.id,
                message_id=row.message_id,
                audio_asset_id=row.audio_asset_id,
                mode=row.mode,
                reference_text=row.reference_text,
                heard_text=row.heard_text,
                accuracy=row.accuracy,
                fluency=row.fluency,
                completeness=row.completeness,
                overall=row.overall,
                wer=row.wer,
                engine=row.engine,
                created_at=row.created_at,
                words=words,
            )
        )
    return out


@router.get("/scores", response_model=list[ScoreRecordOut])
async def conversation_scores(
    conversation_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ScoreRecordOut]:
    """All stored evaluations for one conversation, so the UI hydrates in one request."""
    owns = await db.execute(
        select(Conversation.id).where(
            Conversation.id == conversation_id, Conversation.user_id == current_user.id
        )
    )
    if owns.scalars().first() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    rows = await db.execute(
        select(PronunciationScore)
        .join(Message, Message.id == PronunciationScore.message_id)
        .where(Message.conversation_id == conversation_id)
        .order_by(PronunciationScore.created_at.desc())
    )
    return await _to_records(list(rows.scalars().all()))


@router.get("/scores/{message_id}", response_model=list[ScoreRecordOut])
async def stored_scores(
    message_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ScoreRecordOut]:
    """Replay stored evaluations so a collapsed card can still expand after reload."""
    rows = await db.execute(
        select(PronunciationScore)
        .join(Message, Message.id == PronunciationScore.message_id)
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(
            PronunciationScore.message_id == message_id,
            Conversation.user_id == current_user.id,
        )
        .order_by(PronunciationScore.created_at.desc())
    )
    return await _to_records(list(rows.scalars().all()))


@router.get("/engine")
async def engine_status() -> dict:
    return {
        "engine": pronunciation_service.engine,
        "available": pronunciation_service.available,
        "content_scoring": True,
    }


@router.post("/content", response_model=ContentScore)
async def content_only(
    transcript: str = Form(...), current_user: User = Depends(get_current_user)
) -> ContentScore:
    return await pronunciation_service.content_score(transcript)
