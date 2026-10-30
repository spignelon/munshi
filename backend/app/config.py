"""Environment-driven configuration.

Runtime-editable provider settings (mock mode, Twilio, ElevenLabs, TTS) live in
the database (see services/settings_store.py); values here are only the
bootstrap/default layer.
"""
import os
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

ON_VERCEL = bool(os.environ.get("VERCEL"))


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    groq_api_key: str = ""
    groq_fake: bool = False  # deterministic fake Groq client for tests / offline dev

    database_url: str = ""  # explicit override (any SQLAlchemy URL)
    turso_database_url: str = ""
    turso_auth_token: str = ""
    use_turso: bool = False  # local dev opts in; Vercel uses Turso automatically when configured

    jwt_secret: str = "dev-jwt-secret-change-me-please-use-32+chars"
    jwt_expire_hours: int = 24 * 7
    tts_signing_secret: str = "dev-tts-secret-change-me"
    cron_secret: str = ""

    admin_email: str = "admin@munshi.app"
    admin_password: str = "admin12345"
    demo_email: str = "demo@munshi.app"
    demo_password: str = "demo12345"

    public_base_url: str = "http://localhost:8000"

    # provider env fallbacks (admin settings in the DB take precedence)
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_voice_number: str = ""
    twilio_whatsapp_from: str = "whatsapp:+14155238886"  # Twilio sandbox default
    elevenlabs_api_key: str = ""
    sarvam_api_key: str = ""
    elevenlabs_voice_id: str = ""

    festival_name: str = "Diwali"
    festival_date: str = "2026-11-08"


@lru_cache
def get_settings() -> Settings:
    return Settings()
