from datetime import date as date_type, timedelta
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import User, WeightLog
from ..schemas import WeightLogCreate, WeightLogOut

router = APIRouter(prefix="/weights", tags=["weights"])


@router.post("", response_model=WeightLogOut)
def upsert_weight(
    payload: WeightLogCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    existing = (
        db.query(WeightLog)
        .filter(WeightLog.user_id == user.id, WeightLog.log_date == payload.log_date)
        .first()
    )
    if existing:
        existing.weight_kg = payload.weight_kg
        db.commit()
        db.refresh(existing)
        return existing
    w = WeightLog(user_id=user.id, log_date=payload.log_date, weight_kg=payload.weight_kg)
    db.add(w)
    db.commit()
    db.refresh(w)
    return w


@router.get("", response_model=list[WeightLogOut])
def list_weights(
    days: int = 90,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    cutoff = date_type.today() - timedelta(days=days)
    return (
        db.query(WeightLog)
        .filter(WeightLog.user_id == user.id, WeightLog.log_date >= cutoff)
        .order_by(WeightLog.log_date.asc())
        .all()
    )


@router.get("/today", response_model=WeightLogOut | None)
def today_weight(
    date: date_type,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return (
        db.query(WeightLog)
        .filter(WeightLog.user_id == user.id, WeightLog.log_date == date)
        .first()
    )
