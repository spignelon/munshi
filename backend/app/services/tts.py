"""Text-to-speech: edge-tts (free Microsoft neural Hindi voices) by default,
ElevenLabs when selected in admin settings. Falls back to edge-tts on any failure."""
import asyncio
import hashlib
import hmac
from collections import OrderedDict

import httpx
from sqlalchemy.orm import Session

from ..config import get_settings
from . import sarvam, settings_store

_cache: "OrderedDict[str, tuple[bytes, str]]" = OrderedDict()
_CACHE_MAX = 64
MAX_CHARS = 600


def sign(text: str, voice: str = "") -> str:
    key = get_settings().tts_signing_secret.encode()
    return hmac.new(key, f"{voice}|{text}".encode(), hashlib.sha256).hexdigest()[:32]


def verify(text: str, sig: str, voice: str = "") -> bool:
    return hmac.compare_digest(sign(text, voice), sig or "")


def cap_token(path: str, ref: str = "") -> str:
    """Secret-derived token appended to play-only webhook URLs we hand to Twilio ourselves (?k=...)."""
    return sign(f"{path}|{ref}", "webhook")


def signed_url(text: str) -> str:
    from urllib.parse import quote
    text = text[:MAX_CHARS]
    return f"{get_settings().public_base_url.rstrip('/')}/api/tts/play?text={quote(text)}&sig={sign(text)}"


async def _edge(text: str, voice: str) -> bytes:
    import edge_tts

    buf = bytearray()
    async for chunk in edge_tts.Communicate(text, voice).stream():
        if chunk["type"] == "audio":
            buf += chunk["data"]
    if not buf:
        raise RuntimeError("edge-tts returned no audio")
    return bytes(buf)


def _elevenlabs(text: str, cfg: dict) -> bytes:
    r = httpx.post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{cfg['elevenlabs_voice_id'] or '21m00Tcm4TlvDq8ikWAM'}",
        params={"output_format": "mp3_44100_128"},
        headers={"xi-api-key": cfg["elevenlabs_api_key"], "Content-Type": "application/json"},
        json={"text": text, "model_id": cfg["elevenlabs_model"] or "eleven_multilingual_v2"},
        timeout=40,
    )
    r.raise_for_status()
    return r.content


def synthesize(db: Session, text: str, provider: str | None = None) -> tuple[bytes, str]:
    """Returns (mp3 bytes, provider actually used)."""
    text = (text or "").strip()[:MAX_CHARS]
    if not text:
        raise ValueError("empty text")
    cfg = settings_store.get_all(db)
    wanted = provider or cfg["tts_provider"]
    use_sarvam = wanted == "sarvam" and sarvam.available(db)
    use_eleven = wanted == "elevenlabs" and bool(cfg["elevenlabs_api_key"])
    voice = cfg["edge_voice"]
    which = "sarvam" if use_sarvam else "eleven" if use_eleven else "edge"
    key = hashlib.sha1(f"{which}|{voice}|{cfg['sarvam_speaker']}|{cfg['elevenlabs_voice_id']}|{text}".encode()).hexdigest()
    if key in _cache:
        _cache.move_to_end(key)
        return _cache[key]
    used = "edge"
    audio = b""
    if use_sarvam:
        try:
            audio, used = sarvam.synthesize(db, text), "sarvam"
        except (sarvam.SarvamError, httpx.HTTPError):
            audio = b""  # out of credits / rate limit / network: fall back to the free voice
    if use_eleven and not audio:
        try:
            audio, used = _elevenlabs(text, cfg), "elevenlabs"
        except Exception:
            audio = b""
    if not audio:
        audio = asyncio.run(_edge(text, voice))
        used = "edge"
    _cache[key] = (audio, used)
    while len(_cache) > _CACHE_MAX:
        _cache.popitem(last=False)
    return audio, used


def speech_text(text: str, limit: int = 320) -> str:
    """Trim a reply for speech (credits are metered per character): cut at a sentence end where possible."""
    text = " ".join((text or "").split())
    if len(text) <= limit:
        return text
    cut = text[:limit]
    end = max(cut.rfind(". "), cut.rfind("? "), cut.rfind("! "), cut.rfind("। "))
    return cut[: end + 1] if end > limit * 0.5 else cut.rsplit(" ", 1)[0]
