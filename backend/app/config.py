from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+psycopg://mycalpal:mycalpal@db:5432/mycalpal"
    JWT_SECRET: str = "change-me"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 1440
    USDA_API_KEY: str = ""  # https://fdc.nal.usda.gov/api-key-signup.html
    ADMIN_EMAIL: str = ""   # email of the designated admin user (grants /admin access)


settings = Settings()
