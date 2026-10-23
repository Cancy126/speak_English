import logging
import os
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, Field

from app.core.dependencies import get_current_user
from app.models.user import User
from app.services.tts_service import tts_service
from app.services.whisper_service import WhisperUnavailable, whisper_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/speech", tags=["speech"])

MAX_STT_BYTES = 10 * 1024 * 1024


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    voice: str | None = None


@router.post("/tts")
async def synthesize(
    body: TTSRequest, current_user: User = Depends(get_current_user)
) -> dict:
    """Return a playable URL, or tell the client to use SpeechSynthesis instead.

    Browser TTS is the zero-server-cost default; this endpoint is only for
    voices the browser lacks or for recording the reply as a file.
    """
    path = await tts_service.synthesize(body.text)
    if path is None:
        return {
            "audio_url": None,
            "fallback": "speech-synthesis",
            "text": body.text,
        }
    return {"audio_url": f"/uploads/{path}", "fallback": None, "text": body.text}


@router.post("/transcribe")
async def transcribe(
    audio: UploadFile = File(...),
    duration_ms: int | None = Form(default=None, ge=0),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Push-to-talk transcription: browser audio in, English text out.

    Runs locally on the vendored faster-whisper weights, so it costs nothing and
    works in browsers without the Web Speech API. The caller then sends the text
    through the usual chat route; scoring happens separately in /pronunciation/score
    because an audio_assets row needs a message to hang off.
    """
    payload = await audio.read()
    if not payload:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty audio upload")
    if len(payload) > MAX_STT_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            detail="Audio exceeds 10MB")

    suffix = (audio.filename or "recording.webm").rsplit(".", 1)[-1] or "webm"
    tmp_dir = tempfile.mkdtemp(prefix="stt-")
    tmp_path = Path(tmp_dir) / f"in.{suffix}"
    try:
        tmp_path.write_bytes(payload)
        hyp = await whisper_service.transcribe(tmp_path)
    except WhisperUnavailable as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 — decode failure is a client-side audio problem
        logger.warning("transcription failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Could not decode audio: {type(exc).__name__}",
        ) from exc
    finally:
        tmp_path.unlink(missing_ok=True)
        os.rmdir(tmp_dir)

    return {
        "text": hyp.text,
        "duration": round(hyp.duration, 2),
        "words": [{"word": w.word, "start": round(w.start, 2), "end": round(w.end, 2),
                   "confidence": round(w.confidence, 3)} for w in hyp.words],
        "client_duration_ms": duration_ms,
    }


@router.get("/capabilities")
async def capabilities() -> dict:
    """What the server can actually do right now, for the UI to branch on."""
    return {
        # edge-tts still fails upstream (Sec-MS-GEC 403) on some networks; the client
        # must keep its SpeechSynthesis fallback regardless of this flag.
        "server_tts": True,
        "server_stt": whisper_service.weights_ready,
        "stt_engine": "faster-whisper",
        "note": "STT is server-side (MediaRecorder webm/opus -> faster-whisper); "
                "typing always works, and the browser API is only a legacy path.",
    }
