from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+psycopg://mycalpal:mycalpal@db:5432/mycalpal"
    JWT_SECRET: str = "change-me"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 1440
    USDA_API_KEY: str = ""  # https://fdc.nal.usda.gov/api-key-signup.html
    FATSECRET_CLIENT_ID: str = ""      # https://platform.fatsecret.com/api/
    FATSECRET_CLIENT_SECRET: str = ""
    ADMIN_EMAIL: str = ""   # email of the designated admin user (grants /admin access)

    # Auth mode: "local" = built-in email/password + JWT. "sso" = trust
    # forward-auth headers from an upstream IdP (e.g. Authentik). Default local
    # so a fresh clone works without any external identity provider.
    AUTH_MODE: str = "local"
    SSO_HEADER_USERNAME: str = "X-authentik-username"
    SSO_HEADER_EMAIL: str = "X-authentik-email"
    SSO_HEADER_NAME: str = "X-authentik-name"
    SSO_HEADER_GROUPS: str = "X-authentik-groups"
    SSO_ADMIN_GROUP: str = ""  # users in this group are admins in SSO mode


settings = Settings()
