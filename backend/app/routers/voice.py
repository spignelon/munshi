"""Hands-free voice mode: one request per spoken turn (speech in -> plan / approval -> speech out)."""
import base64
import time

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..auth import current_shop
from ..db import get_db
from ..models import Shop
from ..serializers import plan_out
from ..services import command, speech, tts

router = APIRouter(prefix="/api/voice")
MAX_AUDIO = 4_000_000
MIN_AUDIO = 3_000  # ~0.1 s of 16 kHz WAV: anything smaller is a click, not speech


@router.post("/turn")
def voice_turn(audio: UploadFile = File(...), duration: float | None = Form(default=None),
               shop: Shop = Depends(current_shop), db: Session = Depends(get_db)):
    data = audio.file.read(MAX_AUDIO + 1)
    if len(data) > MAX_AUDIO:
        raise HTTPException(413, "Audio bahut lamba hai.")
    if len(data) < MIN_AUDIO:
        return {"empty": True, "transcript": ""}

    t0 = time.perf_counter()
    transcript, stt_provider = speech.transcribe(db, data, audio.filename or "voice.wav", duration)
    t1 = time.perf_counter()
    if not transcript:  # silence / not understood: no planning, no TTS, no credits spent on a reply
        return {"empty": True, "transcript": "", "stt": stt_provider, "timings": {"stt_ms": round((t1 - t0) * 1000)}}

    result = command.run(db, shop, transcript, channel="voice")
    t2 = time.perf_counter()

    audio_b64, tts_provider = None, None
    try:
        mp3, tts_provider = tts.synthesize(db, tts.speech_text(result["reply"]))
        audio_b64 = base64.b64encode(mp3).decode()
    except Exception:  # noqa: BLE001 - the text reply is still shown; speech is a bonus
        pass
    t3 = time.perf_counter()

    plan = result["plan"]
    return {
        "empty": False, "transcript": transcript, "reply": result["reply"], "decision": result["decision"],
        "plan": plan_out(plan, db, detail=True) if plan else None,
        "audio": audio_b64, "audio_mime": "audio/mpeg",
        "providers": {"stt": stt_provider, "tts": tts_provider},
        "timings": {"stt_ms": round((t1 - t0) * 1000), "think_ms": round((t2 - t1) * 1000), "tts_ms": round((t3 - t2) * 1000)},
    }
