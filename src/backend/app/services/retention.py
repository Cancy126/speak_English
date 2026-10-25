"""Hard-delete of trashed conversations once the recovery window closes.

DB cascades drop the rows, but they do NOT touch files on disk — leaving the
audio behind would be both a disk leak and a privacy problem, since the learner's
voice recordings outlive the conversation they thought they deleted.
"""

import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.audio_asset import AudioAsset
from app.models.conversation import Conversation
from app.models.message import Message
from app.services.storage_service import StorageService

logger = logging.getLogger(__name__)


async def purge_conversations(
    db: AsyncSession, conv_ids: list[int], storage: StorageService | None = None
) -> dict:
    """Physically delete conversations: audio files first, then cascading rows.

    Shared by the 7-day trash sweep and the explicit "永久删除" action so both
    follow the same order: files are removed before rows, and a file failure keeps
    the rows behind it. Deleting the DB rows first would lose `file_path` and
    strand the recording on disk forever — a disk leak and a privacy leak at once,
    since ORM cascade cannot touch the filesystem.
    """
    storage = storage or StorageService()
    if not conv_ids:
        return {"conversations": 0, "files": 0, "file_errors": 0}

    rows = await db.execute(
        select(AudioAsset.file_path)
        .join(Message, Message.id == AudioAsset.message_id)
        .where(Message.conversation_id.in_(conv_ids))
    )
    paths = list(rows.scalars().all())

    removed = failed = 0
    for rel in paths:
        try:
            target: Path = storage.absolute_path(rel)
            if target.is_file():
                target.unlink()
                removed += 1
        except OSError as exc:
            logger.warning("could not delete audio %s: %s", rel, exc)
            failed += 1

    if failed:
        logger.warning("aborting purge of %s: %d file(s) still present", conv_ids, failed)
        return {"conversations": 0, "files": removed, "file_errors": failed}

    for cid in conv_ids:
        conv = await db.get(Conversation, cid)
        if conv is not None:
            await db.delete(conv)
    await db.flush()

    logger.info("purged %d conversation(s), %d audio file(s)", len(conv_ids), removed)
    return {"conversations": len(conv_ids), "files": removed, "file_errors": 0}


async def purge_expired_trash(db: AsyncSession, storage: StorageService | None = None) -> dict:
    """Delete conversations trashed more than TRASH_RETENTION_DAYS ago."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=settings.TRASH_RETENTION_DAYS)

    result = await db.execute(
        select(Conversation.id).where(
            Conversation.deleted_at.is_not(None), Conversation.deleted_at < cutoff
        )
    )
    return await purge_conversations(db, list(result.scalars().all()), storage)


async def purge_orphan_audio(db: AsyncSession, storage: StorageService | None = None) -> int:
    """Delete recordings older than AUDIO_RETENTION_DAYS that no live row needs.

    Only touches files whose audio_assets row is already gone, so it can never
    eat a still-restorable trash recording.
    """
    storage = storage or StorageService()
    root = Path(settings.UPLOAD_DIR).resolve()
    if not root.is_dir():
        return 0

    rows = await db.execute(select(AudioAsset.file_path))
    known = {Path(p).name for p in rows.scalars().all()}
    cutoff = datetime.now(timezone.utc).timestamp() - settings.AUDIO_RETENTION_DAYS * 86400

    removed = 0
    for f in root.glob("*"):
        if not f.is_file() or f.name in known:
            continue
        if f.stat().st_mtime < cutoff:
            try:
                f.unlink()
                removed += 1
            except OSError as exc:
                logger.warning("could not delete orphan %s: %s", f, exc)
    if removed:
        logger.info("removed %d orphaned audio file(s)", removed)
    return removed
