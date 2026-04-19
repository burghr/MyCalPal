from datetime import date, datetime, timezone
from sqlalchemy import String, Integer, Float, ForeignKey, Date, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(100))
    daily_calorie_goal: Mapped[int] = mapped_column(Integer, default=2000)
    # Optional profile fields used to suggest a calorie goal via Mifflin-St Jeor.
    height_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    weight_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sex: Mapped[str | None] = mapped_column(String(10), nullable=True)  # "male" | "female"
    activity_level: Mapped[str | None] = mapped_column(String(20), nullable=True)  # sedentary|light|moderate|active|very_active
    goal_type: Mapped[str | None] = mapped_column(String(20), nullable=True)  # maintain|lose|gain
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    logs: Mapped[list["FoodLog"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    custom_foods: Mapped[list["Food"]] = relationship(back_populates="created_by_user")


class Food(Base):
    """A food item. Can be pulled from Open Food Facts (barcode set) or user-created."""
    __tablename__ = "foods"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), index=True)
    brand: Mapped[str | None] = mapped_column(String(255), nullable=True)
    barcode: Mapped[str | None] = mapped_column(String(64), unique=True, index=True, nullable=True)
    # Display serving: "1 cup", "2 tbsp", "100 g", etc.
    serving_amount: Mapped[float] = mapped_column(Float, default=1.0)
    serving_unit: Mapped[str] = mapped_column(String(32), default="serving")
    # Optional gram equivalent for conversions (not required for non-weight units).
    serving_size_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    calories_per_serving: Mapped[float] = mapped_column(Float)
    protein_g: Mapped[float] = mapped_column(Float, default=0.0)
    carbs_g: Mapped[float] = mapped_column(Float, default=0.0)
    fat_g: Mapped[float] = mapped_column(Float, default=0.0)
    fiber_g: Mapped[float] = mapped_column(Float, default=0.0)
    source: Mapped[str] = mapped_column(String(32), default="manual")  # "manual" | "openfoodfacts"
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    created_by_user: Mapped["User | None"] = relationship(back_populates="custom_foods")
    logs: Mapped[list["FoodLog"]] = relationship(back_populates="food")


class FoodLog(Base):
    """One logged food entry for a user on a given date, tagged by meal."""
    __tablename__ = "food_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    food_id: Mapped[int] = mapped_column(ForeignKey("foods.id"))
    log_date: Mapped[date] = mapped_column(Date, index=True)
    meal: Mapped[str] = mapped_column(String(20))  # breakfast | lunch | dinner | snack
    servings: Mapped[float] = mapped_column(Float, default=1.0)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    user: Mapped["User"] = relationship(back_populates="logs")
    food: Mapped["Food"] = relationship(back_populates="logs")


class WeightLog(Base):
    """One weight measurement per user per date (last write wins)."""
    __tablename__ = "weight_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    log_date: Mapped[date] = mapped_column(Date, index=True)
    weight_kg: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
