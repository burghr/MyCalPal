from datetime import datetime, timedelta, timezone
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from .config import settings
from .database import get_db
from .models import User
from .sso import is_sso_admin, sso_enabled, upsert_sso_user

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login", auto_error=False)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(user_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.JWT_EXPIRE_MINUTES)
    payload = {"sub": str(user_id), "exp": expire}
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def is_admin(user: User, request: Request | None = None) -> bool:
    if sso_enabled() and request is not None:
        groups = request.headers.get(settings.SSO_HEADER_GROUPS)
        if is_sso_admin(groups):
            return True
    admin = (settings.ADMIN_EMAIL or "").strip().lower()
    return bool(admin) and user.email.lower() == admin


def user_to_out(user: User, request: Request | None = None):
    from .schemas import UserOut
    data = UserOut.model_validate(user).model_dump()
    data["is_admin"] = is_admin(user, request)
    return data


def get_current_user(
    request: Request,
    token: str | None = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if sso_enabled():
        return upsert_sso_user(request, db)
    if not token:
        raise credentials_exc
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        user_id = int(payload.get("sub"))
    except (JWTError, ValueError, TypeError):
        raise credentials_exc
    user = db.get(User, user_id)
    if user is None:
        raise credentials_exc
    return user


def require_admin(
    request: Request,
    user: User = Depends(get_current_user),
) -> User:
    if not is_admin(user, request):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin only")
    return user
