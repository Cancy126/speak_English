"""`PATCH /api/chat/conversations/{id}` — the contract both rename entry points share.

The chat page and the history page now call the same store action, so the rules that
used to live in the history page's JSX (trim, blank rejected, 60 chars) are asserted
here against the server instead. If the server stopped trimming, the UI would happily
persist "   " and wipe a conversation's name.
"""

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token, hash_password
from app.db.session import async_session_factory, init_db
from app.main import app
from app.models.conversation import Conversation
from app.models.user import User

LONG = "x" * 61


@pytest.fixture
async def session() -> AsyncSession:
    await init_db()
    async with async_session_factory() as db:
        # One temp database serves the whole run and `users.username` is unique, so
        # each test starts empty instead of colliding with the previous one.
        for table in ("pronunciation_scores", "audio_assets", "messages", "conversations", "users"):
            await db.execute(text(f"DELETE FROM {table}"))
        await db.commit()
        yield db


@pytest.fixture(autouse=True)
def clear_overrides():
    """`test_replay_and_gate` overrides `get_current_user` in the same process; a leak
    would silently replace the real token path these tests are meant to exercise."""
    app.dependency_overrides.clear()
    yield
    app.dependency_overrides.clear()


async def make_two_users(session: AsyncSession):
    a = User(username="alice", email="alice@example.com", password_hash=hash_password("Passw0rd!"))
    b = User(username="bob", email="bob@example.com", password_hash=hash_password("Passw0rd!"))
    session.add_all([a, b])
    await session.flush()
    conv = Conversation(user_id=a.id, topic="Travel")
    session.add(conv)
    await session.commit()
    return a, b, conv


def client_for(user: User) -> AsyncClient:
    return AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}"},
    )


class TestRenameContract:
    async def test_surrounding_whitespace_is_trimmed_server_side(self, session):
        alice, _bob, conv = await make_two_users(session)
        async with client_for(alice) as c:
            resp = await c.patch(f"/api/chat/conversations/{conv.id}", json={"title": "  点餐练习  "})
        assert resp.status_code == 200, resp.text
        assert resp.json()["title"] == "点餐练习"

    async def test_whitespace_only_title_is_rejected(self, session):
        """`min_length` on the raw string would let "  " through and then strip it to
        empty — one blank submit would erase the name. Trimming is validated first."""
        alice, _bob, conv = await make_two_users(session)
        async with client_for(alice) as c:
            resp = await c.patch(f"/api/chat/conversations/{conv.id}", json={"title": "   "})
        assert resp.status_code == 422

    async def test_over_long_title_is_rejected(self, session):
        alice, _bob, conv = await make_two_users(session)
        async with client_for(alice) as c:
            resp = await c.patch(f"/api/chat/conversations/{conv.id}", json={"title": LONG})
        assert resp.status_code == 422

    async def test_renaming_someone_elses_conversation_is_404(self, session):
        _alice, bob, conv = await make_two_users(session)
        async with client_for(bob) as c:
            resp = await c.patch(f"/api/chat/conversations/{conv.id}", json={"title": "不是我的"})
        assert resp.status_code == 404

    async def test_anonymous_is_401(self, session):
        _alice, _bob, conv = await make_two_users(session)
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as c:
            resp = await c.patch(f"/api/chat/conversations/{conv.id}", json={"title": "hi"})
        assert resp.status_code == 401

    async def test_list_reflects_the_new_title(self, session):
        """The store's `openConversation` rebuilds `current` from this list after every
        turn, so a rename that persisted but did not show up here would revert on send."""
        alice, _bob, conv = await make_two_users(session)
        async with client_for(alice) as c:
            await c.patch(f"/api/chat/conversations/{conv.id}", json={"title": "面试模拟"})
            listed = await c.get("/api/chat/conversations")
        match = [x for x in listed.json() if x["id"] == conv.id]
        assert match and match[0]["title"] == "面试模拟"

    async def test_rename_bumps_updated_at(self, session):
        """History sorts by `updated_at desc`, so the list reorders after a rename —
        which is why the history page re-reads instead of trusting a local patch.

        Read back through GET rather than the PATCH response: this asserts the column
        really moved in the database, and `>` (not `>=`) so a no-op cannot pass.
        """
        alice, _bob, conv = await make_two_users(session)
        async with client_for(alice) as c:
            before = (await c.get("/api/chat/conversations")).json()[0]["updated_at"]
            await c.patch(f"/api/chat/conversations/{conv.id}", json={"title": "改名"})
            after = (await c.get("/api/chat/conversations")).json()[0]["updated_at"]
        assert after > before

    async def test_rename_does_not_touch_topic_or_other_fields(self, session):
        alice, _bob, conv = await make_two_users(session)
        async with client_for(alice) as c:
            resp = await c.patch(f"/api/chat/conversations/{conv.id}", json={"title": "新名字"})
        body = resp.json()
        assert body["topic"] == "Travel"
        assert body["deleted_at"] is None
        assert body["id"] == conv.id
