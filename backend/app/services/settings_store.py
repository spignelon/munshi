"""Admin-editable provider settings stored in the DB, with env fallbacks.

`mock_mode` is the global switch: when on, Twilio voice/WhatsApp, ElevenLabs and
payment collection are simulated. Groq is always real.
"""
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import AppSetting

SECRET_KEYS = {"twilio_auth_token", "elevenlabs_api_key", "sarvam_api_key"}

# key -> (default, env attribute on Settings or None)
SCHEMA: dict[str, tuple[str, str | None]] = {
    "mock_mode": ("true", None),
    "stt_provider": ("sarvam", None),  # sarvam | groq (sarvam falls back to groq on error / when unconfigured)
    "tts_provider": ("sarvam", None),  # sarvam | edge | elevenlabs (sarvam falls back to edge)
    "sarvam_api_key": ("", "sarvam_api_key"),
    "sarvam_speaker": ("simran_hi_assistant", None),
    "sarvam_budget_inr": ("85", None),  # stop using Sarvam once the *estimated* spend (incl. GST) reaches this; keeps a buffer
    "edge_voice": ("hi-IN-SwaraNeural", None),
    "elevenlabs_api_key": ("", "elevenlabs_api_key"),
    "elevenlabs_voice_id": ("", "elevenlabs_voice_id"),
    "elevenlabs_model": ("eleven_multilingual_v2", None),
    "twilio_account_sid": ("", "twilio_account_sid"),
    "twilio_auth_token": ("", "twilio_auth_token"),
    "twilio_voice_number": ("", "twilio_voice_number"),
    "twilio_whatsapp_from": ("whatsapp:+14155238886", "twilio_whatsapp_from"),
    # Twilio trial/Tryout WhatsApp senders reject free-text API sends ("ContentSid Required"). With a template SID set, sends use it and
    # {text} in the variables JSON is replaced by Munshi's message (newlines flattened, WhatsApp forbids them in variables).
    "twilio_whatsapp_content_sid": ("", "twilio_whatsapp_content_sid"),
    "twilio_whatsapp_content_vars": ('{"1": "{text}"}', None),
    "reminder_channel": ("whatsapp", None),  # whatsapp | call | both: how udhaar reminders reach customers (calls play Sarvam/Edge/ElevenLabs audio)
    "test_redirect_number": ("", None),  # real mode: send ALL customer/supplier messages & calls here (your sandbox-joined phone)
}

EDGE_VOICES = ["hi-IN-SwaraNeural", "hi-IN-MadhurNeural"]


def _rows(db: Session) -> dict[str, str]:
    return {r.key: r.value for r in db.query(AppSetting).all()}


def get_all(db: Session) -> dict[str, str]:
    env = get_settings()
    rows = _rows(db)
    out: dict[str, str] = {}
    for key, (default, env_attr) in SCHEMA.items():
        if key in rows and rows[key] != "":
            out[key] = rows[key]
        elif env_attr and getattr(env, env_attr, ""):
            out[key] = getattr(env, env_attr)
        else:
            out[key] = default
    return out


def get(db: Session, key: str) -> str:
    return get_all(db)[key]


def is_mock(db: Session) -> bool:
    return get(db, "mock_mode").lower() in ("1", "true", "yes", "on")


def update(db: Session, values: dict[str, str | bool]) -> None:
    for key, val in values.items():
        if key not in SCHEMA:
            continue
        if key in SECRET_KEYS and (val is None or str(val).startswith("••")):
            continue  # masked placeholder echoed back by the UI: keep the stored secret
        sval = ("true" if val else "false") if isinstance(val, bool) else str(val or "")
        row = db.get(AppSetting, key)
        if row:
            row.value = sval
        else:
            db.add(AppSetting(key=key, value=sval))
    db.commit()


def masked(db: Session) -> dict:
    data = get_all(db)
    out: dict = dict(data)
    out["mock_mode"] = data["mock_mode"].lower() in ("1", "true", "yes", "on")
    for k in SECRET_KEYS:
        out[k + "_set"] = bool(data[k])
        out[k] = ("••••" + data[k][-4:]) if data[k] else ""
    return out


def twilio_ready(db: Session) -> bool:
    d = get_all(db)
    return bool(d["twilio_account_sid"] and d["twilio_auth_token"])
