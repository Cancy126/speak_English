import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.db.session import AUDIO_DIR, async_session_factory, engine, init_db, seed_admin
from app.routers import admin, auth, chat, pronunciation, speech
from app.services.pronunciation_service import pronunciation_service
from app.services.retention import purge_expired_trash, purge_orphan_audio

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("speak_english")

PURGE_INTERVAL_SECONDS = 6 * 3600


async def _retention_loop() -> None:
    """Sweeps the 7-day trash and orphaned audio on a timer.

    Without this, `deleted_at` would never be acted on and recordings would sit on
    disk forever — the DB cascade deletes rows but cannot delete files.
    """
    while True:
        try:
            async with async_session_factory() as db:
                purged = await purge_expired_trash(db)
                orphans = await purge_orphan_audio(db)
                if purged["conversations"] or orphans:
                    logger.info("retention sweep: %s, %d orphan file(s)", purged, orphans)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 — a failed sweep must not kill the app
            logger.warning("retention sweep failed: %s", exc)
        await asyncio.sleep(PURGE_INTERVAL_SECONDS)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await seed_admin()
    pronunciation_service.load()
    # Hold the reference and cancel on shutdown: an unreferenced task can be
    # garbage collected mid-flight, and an uncancelled one outlives the app.
    sweeper = asyncio.create_task(_retention_loop())
    logger.info("startup complete — db=%s model=%s", settings.DATABASE_URL, settings.LLM_MODEL)
    if settings.jwt_secret_is_placeholder:
        logger.warning("JWT_SECRET_KEY is still the placeholder value — set it in .env")
    if not settings.llm_ready:
        logger.warning("LLM_API_KEY missing or still the .env.example placeholder — /api/chat returns 502")
    yield
    sweeper.cancel()
    await asyncio.gather(sweeper, return_exceptions=True)
    await engine.dispose()


app = FastAPI(
    title="Speak English API",
    version="0.1.0",
    description="口语练习网站后端 (Phase 1 MVP)",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR = AUDIO_DIR.parent
if STATIC_DIR.exists():
    app.mount("/uploads", StaticFiles(directory=str(STATIC_DIR)), name="uploads")

for module in (auth.router, chat.router, speech.router, pronunciation.router, admin.router):
    app.include_router(module)


@app.get("/api/health", tags=["meta"])
async def health() -> dict:
    return {
        "status": "ok",
        "llm_configured": settings.llm_ready,
        "llm_model": settings.LLM_MODEL,
        "pronunciation_engine": pronunciation_service.engine,
    }
