from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import DB_KIND, get_db
from ..models import Action, CallSession, OutboundMessage, Shop, User
from ..auth import require_admin
from ..serializers import iso
from ..services import groq_client, messaging, sarvam, settings_store, tts
from .core import norm_phone

router = APIRouter(prefix="/api/admin", dependencies=[Depends(require_admin)])


@router.get("/settings")
def get_settings_admin(db: Session = Depends(get_db)):
    s = get_settings()
    return {"settings": settings_store.masked(db), "edge_voices": settings_store.EDGE_VOICES,
            "sarvam_speakers": [{"id": i, "label": l} for i, l in sarvam.SPEAKERS], "sarvam_usage": sarvam.usage(db),
            "webhooks": {"base": s.public_base_url.rstrip("/"),
                         "whatsapp": f"{s.public_base_url.rstrip('/')}/api/webhooks/whatsapp",
                         "voice_inbound": f"{s.public_base_url.rstrip('/')}/api/webhooks/voice/inbound"}}


class SettingsIn(BaseModel):
    values: dict[str, str | bool]


@router.put("/settings")
def put_settings(body: SettingsIn, db: Session = Depends(get_db)):
    if "tts_provider" in body.values and body.values["tts_provider"] not in ("sarvam", "edge", "elevenlabs"):
        raise HTTPException(422, "tts_provider must be sarvam, edge or elevenlabs")
    if "stt_provider" in body.values and body.values["stt_provider"] not in ("sarvam", "groq"):
        raise HTTPException(422, "stt_provider must be sarvam or groq")
    if "sarvam_budget_inr" in body.values:
        try:
            if float(body.values["sarvam_budget_inr"]) < 0:
                raise ValueError
        except ValueError:
            raise HTTPException(422, "sarvam_budget_inr must be a non-negative number")
    if body.values.get("test_redirect_number"):
        body.values["test_redirect_number"] = norm_phone(str(body.values["test_redirect_number"]))
    settings_store.update(db, body.values)
    return {"settings": settings_store.masked(db)}


@router.get("/status")
def status(db: Session = Depends(get_db)):
    s = get_settings()
    cfg = settings_store.get_all(db)
    return {
        "db": {"kind": DB_KIND, "persistent": DB_KIND in ("turso", "sqlite", "custom")},
        "groq": {"configured": bool(s.groq_api_key), "fake": s.groq_fake, "models": {"planner": groq_client.PLANNER_MODEL,
                 "stt": groq_client.STT_MODEL, "vision": groq_client.VISION_MODEL}, "usage": groq_client.usage_snapshot()},
        "twilio": {"configured": settings_store.twilio_ready(db), "voice_number": cfg["twilio_voice_number"], "whatsapp_from": cfg["twilio_whatsapp_from"]},
        "elevenlabs": {"configured": bool(cfg["elevenlabs_api_key"])},
        "sarvam": {"configured": bool(cfg["sarvam_api_key"]), "available": sarvam.available(db), "stt_provider": cfg["stt_provider"],
                   "tts_provider": cfg["tts_provider"], "usage": sarvam.usage(db)},
        "mock_mode": settings_store.is_mock(db),
        "counts": {"users": db.query(User).count(), "shops": db.query(Shop).count(), "actions": db.query(Action).count(),
                   "calls": db.query(CallSession).count(), "messages": db.query(OutboundMessage).count()},
    }


@router.get("/users")
def users(db: Session = Depends(get_db)):
    rows = db.query(User).order_by(User.id.desc()).limit(200).all()
    return [{"id": u.id, "email": u.email, "name": u.name, "role": u.role, "created_at": iso(u.created_at)} for u in rows]


class TtsTestIn(BaseModel):
    text: str = "Namaste, main Munshi hoon. Aapki dukaan ka hisaab taiyaar hai."
    provider: str | None = None


@router.post("/test/tts")
def test_tts(body: TtsTestIn, db: Session = Depends(get_db)):
    from fastapi.responses import Response
    audio, used = tts.synthesize(db, body.text, provider=body.provider)
    return Response(audio, media_type="audio/mpeg", headers={"X-TTS-Provider": used})


class WaTestIn(BaseModel):
    to: str


@router.post("/test/whatsapp")
def test_whatsapp(body: WaTestIn, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    shop = db.query(Shop).filter(Shop.owner_id == admin.id).first()
    m = messaging.send_whatsapp(db, shop, to=norm_phone(body.to), body="Munshi test: WhatsApp connection kaam kar raha hai ✅", recipient_name="Admin test", direct=True)
    db.commit()
    return {"status": m.status, "simulated": m.simulated, "error": m.error, "sid": m.provider_sid}


class CallTestIn(BaseModel):
    to: str


@router.post("/test/call")
def test_call(body: CallTestIn, db: Session = Depends(get_db)):
    if settings_store.is_mock(db):
        return {"status": "simulated", "simulated": True, "error": ""}
    try:
        client, cfg = messaging._twilio_client(db)
        if not cfg["twilio_voice_number"]:
            raise messaging.ProviderNotConfigured("Twilio voice number is not set.")
        base = get_settings().public_base_url.rstrip("/")
        call = client.calls.create(to=norm_phone(body.to), from_=cfg["twilio_voice_number"], url=f"{base}/api/webhooks/voice/test", method="POST")
        return {"status": "queued", "simulated": False, "error": "", "sid": call.sid}
    except Exception as e:  # noqa: BLE001
        return {"status": "failed", "simulated": False, "error": str(e)[:300]}
