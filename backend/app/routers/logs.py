from collections import defaultdict
from datetime import date as date_type
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from ..auth import get_current_user
from ..database import get_db
from ..models import Food, FoodLog, User
from ..schemas import DailySummary, FoodLogCreate, FoodLogOut, FoodLogUpdate

router = APIRouter(prefix="/logs", tags=["logs"])


# Specific paths must be registered BEFORE /{log_id} so FastAPI doesn't try
# to coerce literals like "day" into an int.


@router.post("", response_model=FoodLogOut)
def create_log(
    payload: FoodLogCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    food = db.get(Food, payload.food_id)
    if not food:
        raise HTTPException(404, "Food not found")
    log = FoodLog(user_id=user.id, **payload.model_dump())
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


@router.get("/day", response_model=DailySummary)
def day_summary(
    date: date_type,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    logs = (
        db.query(FoodLog)
        .options(joinedload(FoodLog.food))
        .filter(FoodLog.user_id == user.id, FoodLog.log_date == date)
        .order_by(FoodLog.created_at)
        .all()
    )
    by_meal: dict[str, list[FoodLogOut]] = defaultdict(list)
    totals = {"cal": 0.0, "p": 0.0, "c": 0.0, "f": 0.0, "fi": 0.0}
    for log in logs:
        by_meal[log.meal].append(FoodLogOut.model_validate(log))
        totals["cal"] += log.food.calories_per_serving * log.servings
        totals["p"] += log.food.protein_g * log.servings
        totals["c"] += log.food.carbs_g * log.servings
        totals["f"] += log.food.fat_g * log.servings
        totals["fi"] += log.food.fiber_g * log.servings

    return DailySummary(
        date=date,
        calorie_goal=user.daily_calorie_goal,
        total_calories=round(totals["cal"], 1),
        total_protein_g=round(totals["p"], 1),
        total_carbs_g=round(totals["c"], 1),
        total_fat_g=round(totals["f"], 1),
        total_fiber_g=round(totals["fi"], 1),
        by_meal=dict(by_meal),
    )


@router.get("/history")
def history(
    days: int = 14,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return per-day calorie totals for the last N days."""
    rows = (
        db.query(
            FoodLog.log_date,
            func.sum(Food.calories_per_serving * FoodLog.servings).label("cal"),
        )
        .join(Food, Food.id == FoodLog.food_id)
        .filter(FoodLog.user_id == user.id)
        .group_by(FoodLog.log_date)
        .order_by(FoodLog.log_date.desc())
        .limit(days)
        .all()
    )
    return [{"date": r.log_date, "calories": round(float(r.cal or 0), 1)} for r in rows]


@router.get("/stats")
def stats(
    days: int = 30,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return goal hit/miss counts + per-day calories over the last N days."""
    rows = (
        db.query(
            FoodLog.log_date,
            func.sum(Food.calories_per_serving * FoodLog.servings).label("cal"),
        )
        .join(Food, Food.id == FoodLog.food_id)
        .filter(FoodLog.user_id == user.id)
        .group_by(FoodLog.log_date)
        .order_by(FoodLog.log_date.desc())
        .limit(days)
        .all()
    )
    goal = user.daily_calorie_goal or 2000
    days_logged = len(rows)
    under = sum(1 for r in rows if float(r.cal or 0) <= goal)
    over = days_logged - under
    avg = round(sum(float(r.cal or 0) for r in rows) / days_logged, 1) if days_logged else 0.0
    return {
        "days_logged": days_logged,
        "calorie_goal": goal,
        "under_or_at_goal": under,
        "over_goal": over,
        "average_calories": avg,
        "per_day": [{"date": r.log_date, "calories": round(float(r.cal or 0), 1)} for r in rows],
    }


@router.get("/{log_id}", response_model=FoodLogOut)
def get_log(
    log_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    log = db.query(FoodLog).options(joinedload(FoodLog.food)).filter(FoodLog.id == log_id).first()
    if not log or log.user_id != user.id:
        raise HTTPException(404, "Log not found")
    return log


@router.patch("/{log_id}", response_model=FoodLogOut)
def update_log(
    log_id: int,
    payload: FoodLogUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    log = db.get(FoodLog, log_id)
    if not log or log.user_id != user.id:
        raise HTTPException(404, "Log not found")

    data = payload.model_dump(exclude_unset=True)
    overrides = data.pop("food_overrides", None)

    for field, value in data.items():
        setattr(log, field, value)

    if overrides:
        # Create a user-owned copy of the food so historical logs pointing at
        # the original food aren't silently altered.
        original = log.food
        new_food = Food(
            name=overrides.get("name") or original.name,
            brand=overrides.get("brand", original.brand),
            barcode=None,
            serving_amount=overrides.get("serving_amount", original.serving_amount),
            serving_unit=overrides.get("serving_unit", original.serving_unit),
            serving_size_g=overrides.get("serving_size_g", original.serving_size_g),
            calories_per_serving=overrides.get("calories_per_serving", original.calories_per_serving),
            protein_g=overrides.get("protein_g", original.protein_g),
            carbs_g=overrides.get("carbs_g", original.carbs_g),
            fat_g=overrides.get("fat_g", original.fat_g),
            fiber_g=overrides.get("fiber_g", original.fiber_g),
            source="manual",
            created_by_user_id=user.id,
        )
        db.add(new_food)
        db.flush()
        log.food_id = new_food.id

    db.commit()
    log = db.query(FoodLog).options(joinedload(FoodLog.food)).filter(FoodLog.id == log.id).first()
    return log


@router.delete("/{log_id}")
def delete_log(
    log_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    log = db.get(FoodLog, log_id)
    if not log or log.user_id != user.id:
        raise HTTPException(404, "Log not found")
    db.delete(log)
    db.commit()
    return {"ok": True}
