from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.schemas.auth import check_password_bytes


class UserBase(BaseModel):
    username: str = Field(min_length=2, max_length=50)
    email: EmailStr


class UserCreate(UserBase):
    password: str = Field(min_length=6, max_length=128)

    @field_validator("password")
    @classmethod
    def _password_size(cls, value: str) -> str:
        return check_password_bytes(value)


class UserUpdate(BaseModel):
    username: str | None = Field(default=None, min_length=2, max_length=50)
    is_active: bool | None = None


class UserOut(UserBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    is_admin: bool
    is_active: bool
    created_at: datetime
    last_login: datetime | None = None


class AdminUserCreate(UserCreate):
    is_admin: bool = False
