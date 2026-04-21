import secrets
from datetime import datetime, timezone

from fastapi import HTTPException, Request, status
from sqlalchemy.orm import Session

from .config import settings
from .models import User


def sso_enabled() -> bool:
    return settings.AUTH_MODE.lower() == "sso"


def _header(request: Request, name: str) -> str | None:
    if not name:
        return None
    val = request.headers.get(name)
    return val.strip() if val else None


def is_sso_admin(groups_header: str | None) -> bool:
    admin_group = (settings.SSO_ADMIN_GROUP or "").strip()
    if not admin_group or not groups_header:
        return False
    groups = [g.strip() for g in groups_header.split("|") if g.strip()]
    if len(groups) <= 1:
        groups = [g.strip() for g in groups_header.split(",") if g.strip()]
    return admin_group in groups


def upsert_sso_user(request: Request, db: Session) -> User:
    username = _header(request, settings.SSO_HEADER_USERNAME)
    email = _header(request, settings.SSO_HEADER_EMAIL)
    if not username or not email:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "SSO headers missing — request did not pass through forward-auth proxy",
        )
    display_name = _header(request, settings.SSO_HEADER_NAME) or username

    email_lc = email.lower()
    user = db.query(User).filter(User.email == email_lc).first()
    if user is None:
        user = User(
            email=email_lc,
            password_hash=secrets.token_urlsafe(32),  # unusable; SSO only
            display_name=display_name,
        )
        db.add(user)
    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)
    return user
