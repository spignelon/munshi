"""Sarvam AI (Indic speech): Saaras STT + Bulbul TTS.

Used as the preferred voice provider; Groq Whisper / edge-tts remain the automatic fallback. Credits are limited, so every
call is metered into the DB (works across serverless instances) and a budget guard switches to the fallback before they run out.
Pricing (pay-as-you-go, ex-GST): STT Rs 0.49/min, Bulbul v4 Flash Rs 1.00 per 1,000 characters.
"""
import base64
import logging
import re
from concurrent.futures import ThreadPoolExecutor

import httpx
from sqlalchemy.orm import Session

from ..models import AppSetting
from . import settings_store

log = logging.getLogger("munshi.sarvam")

BASE = "https://api.sarvam.ai"
STT_MODEL = "saaras:v4"
TTS_MODEL = "bulbul:v4-flash"
STT_INR_PER_MIN = 0.49
TTS_INR_PER_1K_CHARS = 1.0
GST = 1.18  # budget math is conservative: assume GST is charged on top

# Curated Hindi voices (Bulbul v4 Flash has 100+; any valid speaker id also works when typed in the admin console).
SPEAKERS = [
    ("simran_hi_assistant", "Simran: assistant (female)"),
    ("sanchita_hi_assistant", "Sanchita: assistant (female)"),
    ("ritu_hi_conversation", "Ritu: conversational (female)"),
    ("kavya_hi_conversational", "Kavya: conversational (female)"),
    ("aditya_hi_conversational", "Aditya: conversational (male)"),
    ("rahul_hi_conversational", "Rahul: conversational (male)"),
    ("aayan_hi_conversational", "Aayan: conversational (male)"),
    ("shubh_enhi_companion", "Shubh: Hindi-English mix (male)"),
]

_MIME = {"wav": "audio/wav", "mp3": "audio/mpeg", "webm": "audio/webm", "ogg": "audio/ogg", "opus": "audio/ogg", "m4a": "audio/mp4",
         "mp4": "audio/mp4", "aac": "audio/aac", "flac": "audio/flac"}


class SarvamError(Exception):
    """kind: credits | rate | auth | budget | unavailable | other"""

    def __init__(self, msg: str, kind: str = "other", status: int = 0):
        super().__init__(msg)
        self.kind, self.status = kind, status


# --- configuration, metering ---------------------------------------------------------------------------------
def api_key(db: Session) -> str:
    return settings_store.get(db, "sarvam_api_key").strip()


def _usage_row(db: Session, key: str) -> float:
    row = db.get(AppSetting, key)
    try:
        return float(row.value) if row and row.value else 0.0
    except ValueError:
        return 0.0


def _add_usage(db: Session, key: str, amount: float) -> None:
    row = db.get(AppSetting, key)
    if row:
        row.value = str(round(_usage_row(db, key) + amount, 3))
    else:
        db.add(AppSetting(key=key, value=str(round(amount, 3))))
    db.commit()


def usage(db: Session) -> dict:
    stt_s, tts_c = _usage_row(db, "usage_sarvam_stt_sec"), _usage_row(db, "usage_sarvam_tts_chars")
    spend = (stt_s / 60 * STT_INR_PER_MIN + tts_c / 1000 * TTS_INR_PER_1K_CHARS) * GST
    try:
        budget = float(settings_store.get(db, "sarvam_budget_inr"))
    except ValueError:
        budget = 85.0
    return {"stt_minutes": round(stt_s / 60, 2), "tts_chars": int(tts_c), "est_spend_inr": round(spend, 2), "budget_inr": budget}


def available(db: Session) -> bool:
    """Configured and still within the credit budget."""
    if not api_key(db):
        return False
    u = usage(db)
    return u["est_spend_inr"] < u["budget_inr"]


# --- HTTP ---------------------------------------------------------------------------------------------------
def _post(path: str, key: str, **kw) -> httpx.Response:  # single choke point (tests monkeypatch this)
    return httpx.post(BASE + path, headers={"api-subscription-key": key}, timeout=40, **kw)


def _check(resp: httpx.Response) -> None:
    if resp.status_code < 400:
        return
    kind = {402: "credits", 429: "rate", 401: "auth", 403: "auth"}.get(resp.status_code, "other")
    log.warning("sarvam %s -> %s %s", resp.request.url.path if resp.request else "", resp.status_code, resp.text[:200])
    raise SarvamError(f"Sarvam API error {resp.status_code}", kind=kind, status=resp.status_code)


def _audio_seconds(audio: bytes, filename: str, hint: float | None) -> float:
    if hint and hint > 0:
        return float(hint)
    if filename.lower().endswith(".wav") and len(audio) > 44:
        return (len(audio) - 44) / 32000.0  # 16 kHz mono 16-bit
    return max(2.0, len(audio) / 4000.0)  # opus/mp3 rough estimate: only used for the budget guard


def transcribe(db: Session, audio: bytes, filename: str = "voice.wav", duration: float | None = None) -> str:
    if not available(db):
        raise SarvamError("Sarvam not configured or budget used up", kind="budget" if api_key(db) else "unavailable")
    ext = filename.rsplit(".", 1)[-1].lower()
    # codemix keeps English words (stock, order, business) in Latin script inside Hindi sentences; "unknown" auto-detects the language.
    resp = _post("/speech-to-text", api_key(db), files={"file": (filename, audio, _MIME.get(ext, "application/octet-stream"))},
                 data={"model": STT_MODEL, "mode": "codemix", "language_code": "unknown"})
    _check(resp)
    _add_usage(db, "usage_sarvam_stt_sec", _audio_seconds(audio, filename, duration))
    return (resp.json().get("transcript") or "").strip()


def _split_sentences(text: str, max_parts: int = 3) -> list[str]:
    """Split into a few sentence-sized chunks so they can be synthesized in parallel (same characters billed, ~half the latency)."""
    if len(text) < 70:
        return [text]
    parts = [p.strip() for p in re.split(r"(?<=[.!?।])\s+", text) if p.strip()]
    merged: list[str] = []
    for p in parts:  # fold very short fragments into the previous one
        if merged and len(p) < 25:
            merged[-1] += " " + p
        else:
            merged.append(p)
    while len(merged) > max_parts:  # merge the shortest adjacent pair
        i = min(range(len(merged) - 1), key=lambda k: len(merged[k]) + len(merged[k + 1]))
        merged[i:i + 2] = [merged[i] + " " + merged[i + 1]]
    return merged or [text]


def _tts_one(key: str, text: str, speaker: str) -> bytes:
    resp = _post("/text-to-speech", key, json={
        "text": text, "language_code": "hi-IN", "model": TTS_MODEL, "speaker": speaker, "output_audio_codec": "mp3",
        "speech_sample_rate": 24000, "pace": 1.0})
    _check(resp)
    audio = b"".join(base64.b64decode(a) for a in resp.json().get("audios", []))
    if not audio:
        raise SarvamError("Sarvam returned no audio")
    return audio


def synthesize(db: Session, text: str) -> bytes:
    if not available(db):
        raise SarvamError("Sarvam not configured or budget used up", kind="budget" if api_key(db) else "unavailable")
    key = api_key(db)
    speaker = settings_store.get(db, "sarvam_speaker") or SPEAKERS[0][0]
    parts = _split_sentences(text)
    if len(parts) == 1:
        audio = _tts_one(key, parts[0], speaker)
    else:
        with ThreadPoolExecutor(len(parts)) as ex:  # concatenated MP3 frames play back-to-back seamlessly
            audio = b"".join(ex.map(lambda t: _tts_one(key, t, speaker), parts))
    _add_usage(db, "usage_sarvam_tts_chars", sum(len(p) for p in parts))
    return audio
