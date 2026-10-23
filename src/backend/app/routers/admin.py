from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import require_admin
from app.core.security import hash_password
from app.db.session import get_db
from app.models.conversation import Conversation
from app.models.user import User
from app.schemas.user import AdminUserCreate, UserOut

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/users", response_model=list[UserOut])
async def list_users(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[User]:
    result = await db.execute(select(User).order_by(User.id).limit(limit).offset(offset))
    return list(result.scalars().all())


@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def create_user(
    body: AdminUserCreate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> User:
    taken = await db.execute(select(User).where(func.lower(User.email) == body.email.lower()))
    if taken.scalars().first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    user = User(
        username=body.username,
        email=body.email.lower(),
        password_hash=hash_password(body.password),
        is_admin=body.is_admin,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return user


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> None:
    if user_id == admin.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Admins cannot delete their own account")
    user = await _get_user(db, user_id)
    await db.delete(user)
    await db.flush()


@router.put("/users/{user_id}/reset-password")
async def reset_password(
    user_id: int,
    new_password: str = Query(min_length=6, max_length=128),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    user = await _get_user(db, user_id)
    user.password_hash = hash_password(new_password)
    await db.flush()
    return {"id": user.id, "reset": True}


@router.get("/stats")
async def stats(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    users = await db.scalar(select(func.count(User.id)))
    conversations = await db.scalar(select(func.count(Conversation.id)))
    return {
        "users": users or 0,
        "conversations": conversations or 0,
    }


async def _get_user(db: AsyncSession, user_id: int) -> User:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalars().first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user
