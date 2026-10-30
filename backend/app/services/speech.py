"""Speech-to-text with provider selection and automatic fallback: Sarvam Saaras (preferred) -> Groq Whisper."""
import logging
import re

import httpx
from sqlalchemy.orm import Session

from . import groq_client, sarvam, settings_store

log = logging.getLogger("munshi.speech")

_OK_CHARS = re.compile(r"[A-Za-z0-9ऀ-ॿ\s.,?!'\"%₹()\-:;/&]")


def looks_garbled(text: str) -> bool:
    """Whisper on poor audio sometimes emits phonetic gibberish in odd scripts (e.g. Icelandic letters). Treat that as 'not understood'."""
    letters = [c for c in text if not c.isspace()]
    if len(letters) < 2:
        return True
    bad = sum(1 for c in letters if not _OK_CHARS.match(c))
    return bad / len(letters) > 0.12


def transcribe(db: Session, audio: bytes, filename: str = "voice.wav", duration: float | None = None) -> tuple[str, str]:
    """Returns (text, provider_used). Empty text means 'could not understand' (silence or garbled)."""
    text, used = "", "groq"
    if settings_store.get(db, "stt_provider") == "sarvam" and sarvam.available(db):
        try:
            text, used = sarvam.transcribe(db, audio, filename, duration), "sarvam"
        except (sarvam.SarvamError, httpx.HTTPError) as e:  # out of credits, rate-limited, network...: fall back, don't fail the turn
            log.warning("Sarvam STT failed (%s); falling back to Groq Whisper", e)
            text = ""
    if used != "sarvam":
        text = groq_client.transcribe(audio, filename)
    text = text.strip()
    return ("" if looks_garbled(text) else text), used
