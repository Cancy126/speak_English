from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
from jose import JWTError, jwt

from app.config import settings

# bcrypt truncates anything past 72 bytes, so a longer secret silently becomes
# a weaker one. Reject at the boundary instead of accepting a truncated factor.
MAX_PASSWORD_BYTES = 72

# Two credentials, two purposes. Without a claim binding them, a 30-day refresh
# token is indistinguishable from a 7-day access token to `get_current_user`.
TOKEN_TYPE_ACCESS = "access"
TOKEN_TYPE_REFRESH = "refresh"


def password_too_long(password: str) -> bool:
    return len(password.encode("utf-8")) > MAX_PASSWORD_BYTES


def hash_password(password: str) -> str:
    if password_too_long(password):
        raise ValueError(f"password must be at most {MAX_PASSWORD_BYTES} bytes")
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    if password_too_long(plain_password):
        # Such a hash could never have been produced; do not call bcrypt and raise.
        return False
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except ValueError:
        return False


def create_access_token(data: dict[str, Any], extra: dict[str, Any] | None = None) -> str:
    return _create_token(data, TOKEN_TYPE_ACCESS, timedelta(days=settings.ACCESS_TOKEN_EXPIRE_DAYS), extra)


def create_refresh_token(data: dict[str, Any], extra: dict[str, Any] | None = None) -> str:
    """Long-lived, single-purpose credential.

    It is only accepted by `/api/auth/refresh`: the `typ` claim is what stops a
    30-day token from being replayed as a 7-day one against the whole API.
    """
    return _create_token(data, TOKEN_TYPE_REFRESH, timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS), extra)


def _create_token(
    data: dict[str, Any], token_type: str, lifetime: timedelta, extra: dict[str, Any] | None
) -> str:
    to_encode = data.copy()
    if extra:
        to_encode.update(extra)
    to_encode["typ"] = token_type
    to_encode["exp"] = datetime.now(timezone.utc) + lifetime
    return jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str, expect_type: str) -> dict[str, Any] | None:
    """Decode and enforce the token's purpose.

    Tokens issued before the `typ` claim existed are treated as access tokens so a
    deploy does not log everyone out; new refresh tokens always carry `typ`, so they
    can never pass as access.
    """
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        return None
    if payload.get("typ", TOKEN_TYPE_ACCESS) != expect_type:
        return None
    return payload


def decode_access_token(token: str) -> dict[str, Any] | None:
    return decode_token(token, TOKEN_TYPE_ACCESS)


def decode_refresh_token(token: str) -> dict[str, Any] | None:
    return decode_token(token, TOKEN_TYPE_REFRESH)
