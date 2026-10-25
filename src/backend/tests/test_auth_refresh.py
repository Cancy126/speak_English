"""Refresh-token contract for 产品规划 3.4.3 (the "logged out every visit" fix).

Two properties matter and both are asserted here:
  * the two credentials are **not interchangeable** — a 30-day refresh token must not
    authenticate the API, or "long-lived" quietly becomes "never log out anywhere";
  * a token minted before the `typ` claim existed still works as an access token, so
    shipping this does not sign everyone out on deploy.

Everything here is local: bcrypt + JWT + SQLite. No LLM or TTS call.
"""

import pytest
from httpx import ASGITransport, AsyncClient
from jose import jwt
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.session import async_session_factory, init_db
from app.main import app
from app.models.user import User
from app.core.security import create_access_token, create_refresh_token

PASSWORD = "Passw0rd!"


@pytest.fixture
async def session() -> AsyncSession:
    await init_db()
    async with async_session_factory() as db:
        # One temp database serves the whole run and `users.username`/`email` are
        # unique, so each test starts empty instead of colliding with the last one.
        for table in ("pronunciation_scores", "audio_assets", "messages", "conversations", "users"):
            await db.execute(text(f"DELETE FROM {table}"))
        await db.commit()
        yield db


@pytest.fixture(autouse=True)
def no_overrides():
    app.dependency_overrides.clear()
    yield
    app.dependency_overrides.clear()


async def register(client: AsyncClient, name: str) -> dict:
    resp = await client.post(
        "/api/auth/register",
        json={"username": name, "email": f"{name}@example.com", "password": PASSWORD},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def authed(tokens: dict) -> AsyncClient:
    return AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )


class TestTokenPair:
    async def test_register_returns_both_credentials(self, session):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            body = await register(c, "pairuser")
        assert body["access_token"] and body["refresh_token"]
        assert body["token_type"] == "bearer"
        # The contract still returns tokens only — no user object (see 3.4 登录契约).
        assert "user" not in body

    async def test_refresh_mints_a_working_pair(self, session):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            tokens = await register(c, "refresher")
            async with authed(tokens) as ac:
                me = await ac.get("/api/auth/me")
        assert me.status_code == 200

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            rotated = await c.post("/api/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
        assert rotated.status_code == 200, rotated.text
        new = rotated.json()
        assert new["refresh_token"]  # rotated together, so the client stores one pair

        async with authed(new) as ac:
            me2 = await ac.get("/api/auth/me")
        assert me2.status_code == 200
        assert me2.json()["username"] == "refresher"

    async def test_login_also_returns_a_pair(self, session):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            await register(c, "logmein")
            resp = await c.post(
                "/api/auth/login", json={"email": "logmein@example.com", "password": PASSWORD}
            )
        assert resp.status_code == 200
        assert resp.json()["refresh_token"]


class TestCredentialsAreNotInterchangeable:
    async def test_refresh_token_cannot_call_the_api(self, session):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            tokens = await register(c, "nosmoke")
            resp = await c.get(
                "/api/auth/me", headers={"Authorization": f"Bearer {tokens['refresh_token']}"}
            )
        assert resp.status_code == 401

    async def test_access_token_cannot_refresh(self, session):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            tokens = await register(c, "norev")
            resp = await c.post("/api/auth/refresh", json={"refresh_token": tokens["access_token"]})
        assert resp.status_code == 401

    async def test_garbage_and_empty_are_rejected(self, session):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            await register(c, "junk")
            bad = await c.post("/api/auth/refresh", json={"refresh_token": "not-a-jwt"})
            missing = await c.post("/api/auth/refresh", json={"refresh_token": "x" * 40})
        assert bad.status_code == 401
        assert missing.status_code == 401


class TestSessionRevocation:
    async def test_deleted_user_cannot_keep_refreshing(self, session):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            tokens = await register(c, "ghost")
        victim = (await session.execute(select(User).where(User.username == "ghost"))).scalars().first()
        await session.delete(victim)
        await session.commit()

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.post("/api/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
        assert resp.status_code == 401

    async def test_deactivated_user_cannot_keep_refreshing(self, session):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            tokens = await register(c, "paused")
        target = (await session.execute(select(User).where(User.username == "paused"))).scalars().first()
        target.is_active = False
        await session.commit()

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.post("/api/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
        assert resp.status_code == 401


class TestNoDeploySignOut:
    async def test_pre_typ_access_token_still_works(self, session):
        """Tokens issued before `typ` existed must not be invalidated by this change."""
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            await register(c, "veteran")
            user = (await session.execute(select(User).where(User.username == "veteran"))).scalars().first()
            legacy = jwt.encode(
                {"sub": str(user.id), "email": user.email},
                settings.JWT_SECRET_KEY,
                algorithm=settings.JWT_ALGORITHM,
            )
            resp = await c.get("/api/auth/me", headers={"Authorization": f"Bearer {legacy}"})
        assert resp.status_code == 200

    async def test_tokens_still_carry_their_own_type(self, session):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            await register(c, "claims")
        a = jwt.decode(create_access_token({"sub": "1"}), settings.JWT_SECRET_KEY,
                       algorithms=[settings.JWT_ALGORITHM])
        r = jwt.decode(create_refresh_token({"sub": "1"}), settings.JWT_SECRET_KEY,
                       algorithms=[settings.JWT_ALGORITHM])
        assert (a["typ"], r["typ"]) == ("access", "refresh")
