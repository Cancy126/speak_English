import asyncio
import logging
import os
from dataclasses import dataclass
from pathlib import Path

from app.config import settings

logger = logging.getLogger(__name__)

# The engine must not reach out to the network at runtime: weights are vendored
# under third-party/ by hand (huggingface.co is unreachable from this network).
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")


@dataclass(slots=True)
class SpokenWord:
    word: str
    start: float
    end: float
    confidence: float


@dataclass(slots=True)
class Hypothesis:
    text: str
    duration: float
    words: list[SpokenWord]


class WhisperUnavailable(RuntimeError):
    pass


def _resolve_model_dir(raw: str) -> Path:
    """Accept an absolute path, or one relative to the project root.

    A bare relative path would otherwise depend on the launch directory: uvicorn
    from src/backend, tests from the repo root, and gunicorn from anywhere else
    would silently disagree about where the weights live.
    """
    p = Path(raw).expanduser()
    if p.is_absolute():
        return p
    root = Path(__file__).resolve().parents[4]
    direct = Path.cwd() / p
    if direct.exists():
        return direct.resolve()
    return (root / p).resolve()


class WhisperService:
    """faster-whisper wrapper: one lazily loaded model per process.

    Inference is CPU-bound and takes ~2s for a 3s clip, so it runs in a worker
    thread; calling it directly from an async handler would freeze the event loop.
    """

    def __init__(self) -> None:
        self._model = None
        self._lock = asyncio.Lock()
        self._dir = _resolve_model_dir(settings.WHISPER_MODEL_DIR)

    @property
    def model_dir(self) -> Path:
        return self._dir

    @property
    def ready(self) -> bool:
        return self._model is not None

    @property
    def weights_ready(self) -> bool:
        """Weights are on disk. Distinct from `ready` (loaded in memory): the model
        lazy-loads on the first recording to avoid holding ~336MB when idle."""
        return not self.missing_files()

    def missing_files(self) -> list[str]:
        """CTranslate2 needs all four of these; a browser download often yields an HTML stub."""
        required = ("config.json", "model.bin", "tokenizer.json", "vocabulary.txt")
        return [f for f in required if not (self._dir / f).is_file()]

    def _load(self):
        from faster_whisper import WhisperModel

        logger.info("loading faster-whisper from %s (%s)", self._dir, settings.WHISPER_COMPUTE_TYPE)
        return WhisperModel(
            str(self._dir),
            device=settings.WHISPER_DEVICE,
            compute_type=settings.WHISPER_COMPUTE_TYPE,
        )

    async def ensure_loaded(self):
        if self._model is not None:
            return self._model
        async with self._lock:
            if self._model is None:
                missing = self.missing_files()
                if missing:
                    raise WhisperUnavailable(f"missing model file(s): {', '.join(missing)} in {self._dir}")
                self._model = await asyncio.to_thread(self._load)
        return self._model

    def _transcribe_sync(self, model, path: str) -> Hypothesis:
        segments, info = model.transcribe(
            path,
            language="en",
            beam_size=1,
            word_timestamps=True,
            vad_filter=False,
        )
        words: list[SpokenWord] = []
        texts: list[str] = []
        for seg in segments:
            texts.append(seg.text.strip())
            for w in seg.words or []:
                words.append(
                    SpokenWord(
                        word=w.word.strip(),
                        start=float(w.start),
                        end=float(w.end),
                        confidence=float(getattr(w, "probability", 0.0) or 0.0),
                    )
                )
        return Hypothesis(
            text=" ".join(t for t in texts if t),
            duration=float(info.duration or 0.0),
            words=words,
        )

    async def transcribe(self, path: str | Path) -> Hypothesis:
        model = await self.ensure_loaded()
        return await asyncio.to_thread(self._transcribe_sync, model, str(path))


whisper_service = WhisperService()
