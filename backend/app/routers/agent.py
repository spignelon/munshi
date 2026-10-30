from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth import current_shop
from ..db import get_db
from ..models import AuditLog, Message, Plan, Shop
from ..serializers import iso, plan_out
from ..services import command, executor, speech, tts

router = APIRouter(prefix="/api")
MAX_AUDIO = 4_000_000


@router.post("/agent/command")
async def agent_command(text: str = Form(default=""), audio: UploadFile | None = File(default=None),
                        shop: Shop = Depends(current_shop), db: Session = Depends(get_db)):
    transcript = text.strip()
    channel = "web"
    if audio is not None:
        data = await audio.read()
        if len(data) > MAX_AUDIO:
            raise HTTPException(413, "Audio bahut lamba hai (max ~4MB).")
        if len(data) < 800:
            raise HTTPException(422, "Aawaz record nahi hui. Dobara try karein.")
        transcript, _ = speech.transcribe(db, data, audio.filename or "audio.webm")
        channel = "web-voice"
    if not transcript:
        raise HTTPException(422, "Samajh nahi aaya. Dobara boliye ya likhiye.")
    result = command.run(db, shop, transcript, channel="web")
    plan = result["plan"]
    return {"transcript": transcript, "voice": audio is not None, "reply": result["reply"], "decision": result["decision"],
            "plan": plan_out(plan, db, detail=True) if plan else None}


@router.get("/agent/history")
def history(shop: Shop = Depends(current_shop), db: Session = Depends(get_db)):
    rows = db.query(Message).filter(Message.shop_id == shop.id).order_by(Message.id.desc()).limit(40).all()
    return [{"id": m.id, "role": m.role, "text": m.text, "channel": m.channel, "plan_id": m.plan_id, "created_at": iso(m.created_at)}
            for m in reversed(rows)]


def _own_plan(db: Session, shop: Shop, pid: int) -> Plan:
    p = db.get(Plan, pid)
    if not p or p.shop_id != shop.id:
        raise HTTPException(404, "Plan nahi mila.")
    return p


class DecisionIn(BaseModel):
    approve: bool
    action_ids: list[int] | None = None
    utterance: str = ""


@router.post("/plans/{pid}/decision")
def decide(pid: int, body: DecisionIn, shop: Shop = Depends(current_shop), db: Session = Depends(get_db)):
    plan = _own_plan(db, shop, pid)
    try:
        executor.decide(db, shop, plan, approve=body.approve, action_ids=body.action_ids, channel="web",
                        utterance=body.utterance or ("Approved from app" if body.approve else "Rejected from app"))
    except ValueError as e:
        raise HTTPException(409, str(e))
    return {"summary": executor.summarize(plan), "plan": plan_out(plan, db, detail=True)}


@router.get("/plans")
def plans(status: str = "", limit: int = 30, shop: Shop = Depends(current_shop), db: Session = Depends(get_db)):
    q = db.query(Plan).filter(Plan.shop_id == shop.id)
    if status:
        q = q.filter(Plan.status == status)
    return [plan_out(p, db, detail=True) for p in q.order_by(Plan.id.desc()).limit(min(limit, 60)).all()]


@router.get("/plans/{pid}")
def plan_detail(pid: int, shop: Shop = Depends(current_shop), db: Session = Depends(get_db)):
    return plan_out(_own_plan(db, shop, pid), db, detail=True)


@router.get("/audit")
def audit(shop: Shop = Depends(current_shop), db: Session = Depends(get_db)):
    rows = db.query(AuditLog).filter(AuditLog.shop_id == shop.id).order_by(AuditLog.id.desc()).limit(80).all()
    return [{"id": r.id, "actor": r.actor, "event": r.event, "ref": r.ref, "detail": r.detail, "created_at": iso(r.created_at)} for r in rows]


class SpeakIn(BaseModel):
    text: str


@router.post("/tts/speak")
def speak(body: SpeakIn, shop: Shop = Depends(current_shop), db: Session = Depends(get_db)):
    try:
        audio, used = tts.synthesize(db, tts.speech_text(body.text))
    except ValueError:
        raise HTTPException(422, "Text khaali hai.")
    except Exception:
        raise HTTPException(503, "Awaaz banane mein dikkat aayi.")
    return Response(audio, media_type="audio/mpeg", headers={"X-TTS-Provider": used, "Cache-Control": "no-store"})
