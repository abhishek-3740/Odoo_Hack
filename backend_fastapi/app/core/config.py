"""Application settings — ports application.yml + .env.example to pydantic-settings.

Every variable name matches the Spring backend so the same .env works untouched.
JDBC urls are converted to SQLAlchemy asyncpg urls automatically.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _to_asyncpg_url(url: str) -> str:
    url = (url or "").strip()
    if url.startswith("jdbc:postgresql://"):
        return "postgresql+asyncpg://" + url[len("jdbc:postgresql://") :]
    if url.startswith("jdbc:"):
        raise ValueError(f"Unsupported JDBC url scheme: {url[:24]}...")
    return url


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- Server ---
    port: int = Field(default=8080, alias="PORT")
    host: str = Field(default="0.0.0.0", alias="HOST")

    # --- Database (Spring names preserved; DATABASE_URL also accepted) ---
    spring_datasource_url: str = Field(
        default="postgresql+asyncpg://postgres:postgres@127.0.0.1:54322/postgres",
        alias="SPRING_DATASOURCE_URL",
    )
    database_url: str | None = Field(default=None, alias="DATABASE_URL")
    spring_datasource_username: str = Field(default="postgres", alias="SPRING_DATASOURCE_USERNAME")
    spring_datasource_password: str = Field(default="postgres", alias="SPRING_DATASOURCE_PASSWORD")
    db_pool_max: int = Field(default=5, alias="DB_POOL_MAX")
    # Test-only override used by tests/itutil.py; harmless at runtime.
    dealflow_test_db_url: str = Field(default="", alias="DEALFLOW_TEST_DB_URL")

    # --- Identity ---
    auth_jwt_secret: str = Field(default="", alias="AUTH_JWT_SECRET")
    auth_jwk_set_uri: str = Field(default="", alias="AUTH_JWK_SET_URI")
    auth_issuer_uri: str = Field(
        default="http://127.0.0.1:54321/auth/v1", alias="AUTH_ISSUER_URI"
    )
    auth_expected_audience: str = Field(default="authenticated", alias="AUTH_EXPECTED_AUDIENCE")
    auth_auto_provision_rep: bool = Field(default=True, alias="AUTH_AUTO_PROVISION_REP")
    auth_local_jwt_secret: str = Field(default="", alias="AUTH_LOCAL_JWT_SECRET")
    app_allowed_origins: str = Field(
        default="http://localhost:3000,http://127.0.0.1:3000", alias="APP_ALLOWED_ORIGINS"
    )
    supabase_url: str = Field(default="http://127.0.0.1:54321", alias="SUPABASE_URL")
    supabase_service_role_key: str = Field(default="", alias="SUPABASE_SERVICE_ROLE_KEY")

    # --- Behaviour ---
    billing_timezone: str = Field(default="Asia/Kolkata", alias="BILLING_TIMEZONE")
    allocation_mode: str = Field(default="BALANCED", alias="ALLOCATION_MODE")
    jobs_enabled: bool = Field(default=True, alias="JOBS_ENABLED")
    demo_seed: bool = Field(default=False, alias="DEMO_SEED")
    demo_mode: bool = Field(default=False, alias="DEMO_MODE")
    demo_business_date: str = Field(default="", alias="DEMO_BUSINESS_DATE")
    demo_auth_enabled: bool = Field(default=False, alias="DEMO_AUTH_ENABLED")
    demo_jwt_secret: str = Field(default="", alias="DEMO_JWT_SECRET")

    # --- Integrations ---
    sarvam_api_key: str = Field(default="", alias="SARVAM_API_KEY")
    sarvam_model: str = Field(default="sarvam-105b", alias="SARVAM_MODEL")
    gemini_api_key: str = Field(default="", alias="GEMINI_API_KEY")
    gemini_model: str = Field(default="gemini-3.5-flash-lite", alias="GEMINI_MODEL")
    groq_api_key: str = Field(default="", alias="GROQ_API_KEY")
    groq_model: str = Field(default="openai/gpt-oss-120b", alias="GROQ_MODEL")

    @field_validator("spring_datasource_url", "database_url", mode="before")
    @classmethod
    def _empty_to_none(cls, v: object) -> object:
        if isinstance(v, str) and not v.strip():
            return None
        return v

    @property
    def sqlalchemy_url(self) -> str:
        raw = self.database_url or self.spring_datasource_url
        return _to_asyncpg_url(raw)

    @property
    def allowed_origins(self) -> list[str]:
        return [o.strip() for o in self.app_allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
