from pydantic import BaseModel, EmailStr, Field, field_validator

from app.core.security import MAX_PASSWORD_BYTES, password_too_long


def check_password_bytes(value: str) -> str:
    if password_too_long(value):
        raise ValueError(f"password must be at most {MAX_PASSWORD_BYTES} bytes")
    return value


class RegisterRequest(BaseModel):
    username: str = Field(min_length=2, max_length=50)
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)

    @field_validator("password")
    @classmethod
    def _password_size(cls, value: str) -> str:
        return check_password_bytes(value)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)

    @field_validator("password")
    @classmethod
    def _password_size(cls, value: str) -> str:
        return check_password_bytes(value)


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=1)
