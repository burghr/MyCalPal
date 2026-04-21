from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from ..auth import create_access_token, hash_password, verify_password, get_current_user, user_to_out
from ..config import settings
from ..database import get_db
from ..models import User
from ..schemas import PasswordChange, Token, UserCreate, UserLogin, UserOut, UserUpdate
from ..sso import sso_enabled

router = APIRouter(prefix="/auth", tags=["auth"])


def _block_when_sso():
    if sso_enabled():
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Disabled in SSO mode — authentication is handled by the upstream identity provider",
        )


@router.get("/config")
def auth_config():
    return {"mode": "sso" if sso_enabled() else "local"}


@router.post("/signup", response_model=Token)
def signup(payload: UserCreate, db: Session = Depends(get_db)):
    _block_when_sso()
    existing = db.query(User).filter(User.email == payload.email).first()
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
    data = payload.model_dump(exclude={"password"})
    user = User(password_hash=hash_password(payload.password), **data)
    user.last_login_at = datetime.now(timezone.utc)
    db.add(user)
    db.commit()
    db.refresh(user)
    return Token(access_token=create_access_token(user.id), user=user_to_out(user))


@router.post("/login", response_model=Token)
def login(payload: UserLogin, db: Session = Depends(get_db)):
    _block_when_sso()
    user = db.query(User).filter(User.email == payload.email).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)
    return Token(access_token=create_access_token(user.id), user=user_to_out(user))


@router.get("/me", response_model=UserOut)
def me(request: Request, user: User = Depends(get_current_user)):
    return user_to_out(user, request)


@router.patch("/me", response_model=UserOut)
def update_me(
    request: Request,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(user, field, value)
    db.commit()
    db.refresh(user)
    return user_to_out(user, request)


@router.post("/me/password")
def change_password(
    payload: PasswordChange,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _block_when_sso()
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect")
    user.password_hash = hash_password(payload.new_password)
    db.commit()
    return {"ok": True}
