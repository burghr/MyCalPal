from datetime import date, datetime
from pydantic import BaseModel, EmailStr, Field


SEX_PATTERN = "^(male|female)$"
ACTIVITY_PATTERN = "^(sedentary|light|moderate|active|very_active)$"
GOAL_PATTERN = "^(maintain|lose|gain)$"


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    display_name: str = Field(min_length=1, max_length=100)
    daily_calorie_goal: int = 2000
    height_cm: float | None = None
    weight_kg: float | None = None
    age: int | None = None
    sex: str | None = Field(default=None, pattern=SEX_PATTERN)
    activity_level: str | None = Field(default=None, pattern=ACTIVITY_PATTERN)
    goal_type: str | None = Field(default=None, pattern=GOAL_PATTERN)


class UserUpdate(BaseModel):
    display_name: str | None = None
    daily_calorie_goal: int | None = None
    height_cm: float | None = None
    weight_kg: float | None = None
    age: int | None = None
    sex: str | None = Field(default=None, pattern=SEX_PATTERN)
    activity_level: str | None = Field(default=None, pattern=ACTIVITY_PATTERN)
    goal_type: str | None = Field(default=None, pattern=GOAL_PATTERN)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: int
    email: EmailStr
    display_name: str
    daily_calorie_goal: int
    height_cm: float | None = None
    weight_kg: float | None = None
    age: int | None = None
    sex: str | None = None
    activity_level: str | None = None
    goal_type: str | None = None
    is_admin: bool = False
    last_login_at: datetime | None = None
    created_at: datetime | None = None

    class Config:
        from_attributes = True


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8)


class AdminPasswordReset(BaseModel):
    new_password: str = Field(min_length=8)


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class FoodBase(BaseModel):
    name: str
    brand: str | None = None
    barcode: str | None = None
    serving_amount: float = 1.0
    serving_unit: str = "serving"
    serving_size_g: float | None = None
    calories_per_serving: float
    protein_g: float = 0.0
    carbs_g: float = 0.0
    fat_g: float = 0.0
    fiber_g: float = 0.0


class FoodCreate(FoodBase):
    pass


class FoodOut(FoodBase):
    id: int
    source: str

    class Config:
        from_attributes = True


MEAL_PATTERN = "^(breakfast|lunch|dinner|snack)$"


class FoodLogCreate(BaseModel):
    food_id: int
    log_date: date
    meal: str = Field(pattern=MEAL_PATTERN)
    servings: float = 1.0
    notes: str | None = None


class FoodNutritionOverride(BaseModel):
    name: str | None = None
    brand: str | None = None
    serving_amount: float | None = None
    serving_unit: str | None = None
    serving_size_g: float | None = None
    calories_per_serving: float | None = None
    protein_g: float | None = None
    carbs_g: float | None = None
    fat_g: float | None = None
    fiber_g: float | None = None


class FoodLogUpdate(BaseModel):
    log_date: date | None = None
    meal: str | None = Field(default=None, pattern=MEAL_PATTERN)
    servings: float | None = None
    notes: str | None = None
    # If provided, server will create a user-owned copy of the food with
    # these overrides applied and relink the log to it (preserving history
    # on other logs that reference the original food).
    food_overrides: FoodNutritionOverride | None = None


class FoodLogOut(BaseModel):
    id: int
    log_date: date
    meal: str
    servings: float
    notes: str | None
    food: FoodOut
    created_at: datetime

    class Config:
        from_attributes = True


class WeightLogCreate(BaseModel):
    log_date: date
    weight_kg: float = Field(gt=0)


class WeightLogOut(BaseModel):
    id: int
    log_date: date
    weight_kg: float

    class Config:
        from_attributes = True


class DailySummary(BaseModel):
    date: date
    calorie_goal: int
    total_calories: float
    total_protein_g: float
    total_carbs_g: float
    total_fat_g: float
    total_fiber_g: float
    by_meal: dict[str, list[FoodLogOut]]
