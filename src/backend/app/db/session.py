from collections.abc import AsyncIterator
from pathlib import Path

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings

engine = create_async_engine(settings.DATABASE_URL, echo=False, future=True)

# SQLite gets WAL + busy_timeout so concurrent writes queue instead of failing.
if settings.DATABASE_URL.startswith("sqlite"):

    @event.listens_for(engine.sync_engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _record) -> None:
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)

AUDIO_DIR = Path(settings.UPLOAD_DIR).resolve()
AUDIO_DIR.mkdir(parents=True, exist_ok=True)


async def get_db() -> AsyncIterator[AsyncSession]:
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def init_db() -> None:
    """Create tables from the mapped models. Called at startup."""
    from app.db.base import Base
    import app.models  # noqa: F401 — registering every table on Base.metadata

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def seed_admin() -> None:
    """Ensure one admin account exists so 产品规划 3.4 后台 is reachable on a fresh DB."""
    from sqlalchemy import select

    from app.core.security import hash_password
    from app.models.user import User

    async with async_session_factory() as session:
        existing = await session.execute(select(User).where(User.is_admin.is_(True)))
        if existing.scalars().first():
            return
        session.add(
            User(
                username="admin",
                email=settings.ADMIN_EMAIL.lower(),
                password_hash=hash_password(settings.ADMIN_PASSWORD),
                is_admin=True,
            )
        )
        await session.commit()
