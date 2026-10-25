"""Replay route and the "rejected takes are not data" rule (产品规划 3.2.7 / 3.2.8).

`whisper_service.transcribe` is patched, so these touch no model weights, no audio
decoding and no paid API — they exercise the routes only. `get_db` is deliberately
NOT overridden: the app's own session commits, and a non-committing override would
make the "no row was written" assertions pass for the wrong reason.
"""

from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.session import async_session_factory, init_db
from app.core.dependencies import get_current_user
from app.main import app
from app.models.audio_asset import AudioAsset
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.pronunciation_score import PronunciationScore
from app.models.user import User
from app.services.whisper_service import Hypothesis, SpokenWord, WhisperService

REF = "Are you ready to order, or just saying hi first?"

# The measured silent take: 12.06s of audio, 0.7s of speech (6%).
SILENT = Hypothesis(
    text="Hello?",
    duration=12.06,
    words=[SpokenWord(word="Hello?", start=6.42, end=7.12, confidence=0.95)],
)

OFF_TOPIC = Hypothesis(
    text="hey there are some things about your head with others",
    duration=8.76,
    words=[
        SpokenWord(word=w, start=i * 0.45, end=i * 0.45 + 0.4, confidence=0.95)
        for i, w in enumerate(
            ["hey", "there", "are", "some", "things", "about", "your", "head", "with", "others"]
        )
    ],
)

FAKE_WEBM = b"\x1a\x45\xdf\xa3not-really-a-recording"


@pytest.fixture
async def session() -> AsyncSession:
    await init_db()
    async with async_session_factory() as db:
        # One temp database serves the whole run and `users.username` is unique, so
        # each test starts from empty instead of colliding with the previous one.
        for table in ("pronunciation_scores", "audio_assets", "messages", "conversations", "users"):
            await db.execute(text(f"DELETE FROM {table}"))
        await db.commit()
        yield db


@pytest.fixture(autouse=True)
def anonymous():
    app.dependency_overrides.clear()
    yield
    app.dependency_overrides.clear()


async def make_world(session: AsyncSession):
    """A learner with one conversation and one message, plus an unrelated second user."""
    owner = User(username="owner", email="owner@example.com", password_hash="x")
    other = User(username="other", email="other@example.com", password_hash="x")
    session.add_all([owner, other])
    await session.flush()

    conv = Conversation(user_id=owner.id, topic="Restaurant", title="点餐练习")
    session.add(conv)
    await session.flush()

    mine = Message(conversation_id=conv.id, user_id=owner.id, role="user", content="hi", sequence=1)
    session.add(mine)
    await session.commit()
    return owner, other, conv, mine


def client_as(user: User) -> AsyncClient:
    app.dependency_overrides[get_current_user] = lambda: user
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def score(client: AsyncClient, message_id: int, mode: str = "read_aloud"):
    return await client.post(
        "/api/pronunciation/score",
        files={"audio": ("rec.webm", FAKE_WEBM, "audio/webm")},
        data={
            "reference_text": REF,
            "message_id": str(message_id),
            "mode": mode,
            "duration_ms": "12060",
        },
    )


async def score_rows(db: AsyncSession) -> int:
    return int(await db.scalar(select(func.count(PronunciationScore.id))) or 0)


def patch_transcribe(monkeypatch, hypothesis: Hypothesis) -> None:
    """Weights present, and the given transcript returned whatever the file holds."""
    monkeypatch.setattr(WhisperService, "weights_ready", property(lambda self: True))
    monkeypatch.setattr(WhisperService, "transcribe", lambda self, path: _fixed(hypothesis))


async def _fixed(hypothesis: Hypothesis) -> Hypothesis:
    return hypothesis


class TestRejectedTakeIsNotPersisted:
    async def test_silent_take_is_rejected_without_a_score(self, session, monkeypatch):
        owner, _other, _conv, mine = await make_world(session)
        patch_transcribe(monkeypatch, SILENT)

        async with client_as(owner) as client:
            resp = await score(client, mine.id)

        assert resp.status_code == 200, resp.text
        body = resp.json()["pronunciation"]
        assert body["attempt_ok"] is False
        assert body["reject_code"] == "silent"
        assert body["available"] is True, "the engine worked; the take did not"
        assert resp.json()["score_id"] is None

    async def test_silent_take_writes_no_pronunciation_score_row(self, session, monkeypatch):
        owner, _other, _conv, mine = await make_world(session)
        patch_transcribe(monkeypatch, SILENT)
        before = await score_rows(session)

        async with client_as(owner) as client:
            await score(client, mine.id)

        assert await score_rows(session) == before == 0

    async def test_off_topic_read_aloud_is_rejected_not_graded(self, session, monkeypatch):
        """The documented flaw: this take used to score 35.2 as if the pronunciation
        were merely poor, when the learner had not read the sentence at all."""
        owner, _other, _conv, mine = await make_world(session)
        patch_transcribe(monkeypatch, OFF_TOPIC)

        async with client_as(owner) as client:
            body = (await score(client, mine.id)).json()["pronunciation"]

        assert body["attempt_ok"] is False
        assert body["reject_code"] == "not_read_aloud"
        # The learner is told what was actually heard, so the rejection is checkable.
        assert "things about your head" in body["transcript"]

    async def test_free_mode_silence_is_also_not_stored(self, session, monkeypatch):
        owner, _other, _conv, mine = await make_world(session)
        patch_transcribe(monkeypatch, SILENT)

        async with client_as(owner) as client:
            body = (await score(client, mine.id, mode="free")).json()

        assert body["pronunciation"]["attempt_ok"] is False
        assert body["score_id"] is None
        assert await score_rows(session) == 0

    async def test_rejected_take_is_still_stored_as_audio(self, session, monkeypatch):
        """Kept on purpose: hearing the silent take is how the learner sees the problem."""
        owner, _other, _conv, mine = await make_world(session)
        patch_transcribe(monkeypatch, SILENT)

        async with client_as(owner) as client:
            resp = await score(client, mine.id)
            asset_id = resp.json()["audio_asset_id"]
            replay = await client.get(f"/api/pronunciation/recordings/{asset_id}")

        assert asset_id is not None
        assert replay.status_code == 200
        assert replay.headers["content-type"].startswith("audio/")
        assert replay.content == FAKE_WEBM


class TestReplayOwnership:
    async def test_another_users_recording_is_invisible(self, session):
        owner, other, _conv, mine = await make_world(session)
        name = "user-owner-1-aaaa1111.webm"
        (Path(settings.UPLOAD_DIR) / name).write_bytes(b"private-voice")
        asset = AudioAsset(
            message_id=mine.id, user_id=owner.id, kind="user_recording",
            file_path=f"audio/{name}", duration_ms=1200,
        )
        session.add(asset)
        await session.commit()

        async with client_as(other) as client:
            resp = await client.get(f"/api/pronunciation/recordings/{asset.id}")

        # 404, not 403: the existence of someone else's recording is not disclosed.
        assert resp.status_code == 404

    async def test_owner_can_replay(self, session):
        owner, _other, _conv, mine = await make_world(session)
        name = "user-owner-2-bbbb2222.webm"
        (Path(settings.UPLOAD_DIR) / name).write_bytes(b"my-voice")
        asset = AudioAsset(
            message_id=mine.id, user_id=owner.id, kind="user_recording",
            file_path=f"audio/{name}", duration_ms=1200,
        )
        session.add(asset)
        await session.commit()

        async with client_as(owner) as client:
            resp = await client.get(f"/api/pronunciation/recordings/{asset.id}")

        assert resp.status_code == 200
        assert resp.content == b"my-voice"

    async def test_anonymous_cannot_replay(self, session):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get("/api/pronunciation/recordings/1")
        assert resp.status_code == 401

    async def test_swept_file_reports_gone(self, session):
        """Row kept, file already purged by retention: a distinct, honest answer."""
        owner, _other, _conv, mine = await make_world(session)
        asset = AudioAsset(
            message_id=mine.id, user_id=owner.id, kind="user_recording",
            file_path="audio/already-swept.webm", duration_ms=900,
        )
        session.add(asset)
        await session.commit()

        async with client_as(owner) as client:
            resp = await client.get(f"/api/pronunciation/recordings/{asset.id}")
        assert resp.status_code == 410


class TestUploadsNoLongerPublic:
    async def test_recording_path_is_not_served_without_auth(self):
        """/uploads used to be a public StaticFiles mount over the recording folder.

        The replay feature would have been built on top of that leak, so the mount
        is gone and recordings are reachable only through the ownership check above.
        """
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get("/uploads/audio/user-2-1-27f77991.webm")
        assert resp.status_code == 404

    async def test_tts_file_route_refjects_recording_names(self):
        """The public TTS route must not become a way to read `user-*` files."""
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get("/api/speech/tts-file/user-2-1-27f77991.webm")
        assert resp.status_code == 404

    async def test_tts_file_route_refjects_traversal(self):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get("/api/speech/tts-file/..%2F..%2Fetc%2Fpasswd")
        assert resp.status_code in (404, 422)


class TestTTSUrlContract:
    """`/api/speech/tts` and `ChatReply.tts_url` must agree on one playable shape.

    They used to disagree: the chat route put the storage-relative path
    ("audio/tts-x.mp3") into `tts_url`, which is not a URL at all and pointed at
    nothing once the public /uploads mount went away. `_edge_tts` is patched, so no
    test here reaches the Microsoft endpoint.
    """

    async def test_tts_endpoint_returns_a_playable_route(self, session):
        owner, _other, _conv, _mine = await make_world(session)

        async def fake_edge(text, target):
            target.write_bytes(b"ID3fake-mp3")
            return True

        from app.services import tts_service as tts_module

        tts_module.tts_service._edge_tts = fake_edge
        try:
            async with client_as(owner) as client:
                resp = await client.post("/api/speech/tts", json={"text": "Order up!"})
                url = resp.json()["audio_url"]
                assert url is not None
                assert url.startswith("/api/speech/tts-file/"), url
                played = await client.get(url)
            assert played.status_code == 200
            assert played.headers["content-type"] == "audio/mpeg"
        finally:
            del tts_module.tts_service.__dict__["_edge_tts"]

    async def test_service_returns_the_same_shape_the_chat_route_stores(self):
        from app.services import tts_service as tts_module

        async def fake_edge(text, target):
            target.write_bytes(b"ID3fake-mp3")
            return True

        tts_module.tts_service._edge_tts = fake_edge
        try:
            url = await tts_module.tts_service.synthesize("hello there")
        finally:
            del tts_module.tts_service.__dict__["_edge_tts"]

        assert url is not None and url.startswith("/api/speech/tts-file/")


class TestFreeModeIgnoresAlignment:
    """自由表达 has no reference sentence, so the read-aloud gate cannot apply.

    The same words that are rejected as "not read aloud" in read-aloud mode are a
    legitimate free turn — only the silence gate is shared between the modes.
    """

    async def test_off_topic_words_are_scored_in_free_mode(self, session, monkeypatch):
        owner, _other, _conv, mine = await make_world(session)
        patch_transcribe(monkeypatch, OFF_TOPIC)

        async with client_as(owner) as client:
            body = (await score(client, mine.id, mode="free")).json()["pronunciation"]

        assert body["attempt_ok"] is True
        assert body["reject_code"] is None
        assert body["wer"] is None, "no reference means no WER, not WER 0"

    async def test_the_same_words_are_rejected_in_read_aloud_mode(self, session, monkeypatch):
        owner, _other, _conv, mine = await make_world(session)
        patch_transcribe(monkeypatch, OFF_TOPIC)

        async with client_as(owner) as client:
            body = (await score(client, mine.id, mode="read_aloud")).json()["pronunciation"]

        assert body["attempt_ok"] is False
        assert body["reject_code"] == "not_read_aloud"

    async def test_silence_is_rejected_in_both_modes(self, session, monkeypatch):
        owner, _other, _conv, mine = await make_world(session)
        patch_transcribe(monkeypatch, SILENT)

        async with client_as(owner) as client:
            free = (await score(client, mine.id, mode="free")).json()["pronunciation"]
            read = (await score(client, mine.id, mode="read_aloud")).json()["pronunciation"]

        assert free["reject_code"] == read["reject_code"] == "silent"
