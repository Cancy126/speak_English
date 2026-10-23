import asyncio
import logging
from pathlib import Path
from uuid import uuid4

import httpx

from app.config import settings
from app.services.storage_service import StorageService

logger = logging.getLogger(__name__)


class TTSService:
    """AI reply -> mp3.

    edge-tts is preferred (free, natural). It talks to a Microsoft endpoint that
    changes occasionally, so we fall back to the browser's SpeechSynthesis API
    (the frontend handles that) by returning None instead of raising.
    """

    def __init__(self, storage: StorageService | None = None) -> None:
        self.storage = storage or StorageService()
        self.voice = settings.TTS_VOICE

    async def synthesize(self, text: str) -> str | None:
        """Return a web-relative audio path, or None when TTS is unavailable."""
        clean = text.strip()
        if not clean:
            return None

        filename = f"tts-{uuid4().hex}.mp3"
        target: Path = self.storage.root / filename
        if await self._edge_tts(clean, target):
            return self.storage.relative_path(filename)
        return None

    async def _edge_tts(self, text: str, target: Path) -> bool:
        try:
            import edge_tts

            await edge_tts.Communicate(text, self.voice).save(str(target))
            return target.exists() and target.stat().st_size > 0
        except Exception as exc:  # noqa: BLE001 — degrade to browser TTS on any failure
            logger.warning("edge-tts failed, frontend will use SpeechSynthesis: %s", exc)
            target.unlink(missing_ok=True)
            return False

    async def synthesize_cli(self, text: str, target: Path) -> bool:
        """Backup path: the edge-tts console script, if the module import is unavailable."""
        cmd = ["edge-tts", "--voice", self.voice, "--text", text, "--write-media", str(target)]
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL
            )
            await asyncio.wait_for(proc.wait(), timeout=20)
            return proc.returncode == 0 and target.exists()
        except (asyncio.TimeoutError, FileNotFoundError, OSError) as exc:
            logger.warning("edge-tts CLI failed: %s", exc)
            return False


class STTService:
    """Optional server-side STT.

    Web Speech API handles STT in the browser, so this only exists as the
    documented fallback for browsers without it. Whisper.cpp is wired in when
    WHISPER_BIN is provided; otherwise calls return None.
    """

    def __init__(self) -> None:
        import os

        self.bin = os.getenv("WHISPER_BIN", "")

    @property
    def available(self) -> bool:
        return bool(self.bin)

    async def transcribe(self, audio_path: Path) -> str | None:
        if not self.available:
            return None
        proc = await asyncio.create_subprocess_exec(
            self.bin, str(audio_path), "-m", "base.en", "-otxt",
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
        )
        await asyncio.wait_for(proc.wait(), timeout=120)
        out = audio_path.with_suffix(".txt")
        return out.read_text().strip() if out.exists() else None


class HealthCheck:
    @staticmethod
    async def llm_reachable() -> bool:
        base = settings.LLM_BASE_URL.rstrip("/")
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{base}/models",
                                        headers={"Authorization": f"Bearer {settings.LLM_API_KEY}"})
            return resp.status_code < 500
        except httpx.HTTPError:
            return False


tts_service = TTSService()
stt_service = STTService()
