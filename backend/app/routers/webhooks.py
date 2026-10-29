"""Twilio webhooks: WhatsApp (sandbox) and voice (supplier calls + inbound calls to Munshi)."""
import re
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session
from twilio.request_validator import RequestValidator
from twilio.twiml.messaging_response import MessagingResponse
from twilio.twiml.voice_response import VoiceResponse

from ..config import get_settings
from ..db import get_db
from ..models import Action, CallSession, Plan, Shop
from ..services import agent, command, executor, groq_client, ocr, settings_store, telephony, tts

router = APIRouter(prefix="/api/webhooks")


def _xml(resp) -> Response:
    return Response(str(resp), media_type="application/xml")


async def _form(request: Request, db: Session) -> dict:
    """Parse the form and verify Twilio's signature (skipped only in mock mode without an auth token)."""
    form = dict((await request.form()).items())
    token = settings_store.get(db, "twilio_auth_token")
    if settings_store.is_mock(db) and not token:
        return form
    if not token:
        raise HTTPException(403, "Twilio auth token not configured")
    url = get_settings().public_base_url.rstrip("/") + request.url.path + (f"?{request.url.query}" if request.url.query else "")
    if not RequestValidator(token).validate(url, form, request.headers.get("X-Twilio-Signature", "")):
        raise HTTPException(403, "Invalid Twilio signature")
    return form


def _digits(p: str) -> str:
    return re.sub(r"\D", "", p or "")[-10:]


def _shop_by_phone(db: Session, phone: str) -> Shop | None:
    d = _digits(phone)
    if not d:
        return None
    for s in db.query(Shop).filter(Shop.whatsapp_number != "").all():
        if _digits(s.whatsapp_number) == d:
            return s
    return None


def _download(db: Session, url: str) -> bytes:
    import httpx
    cfg = settings_store.get_all(db)
    r = httpx.get(url, auth=(cfg["twilio_account_sid"], cfg["twilio_auth_token"]), timeout=30, follow_redirects=True)
    r.raise_for_status()
    return r.content


def _plan_text(reply: str, plan: Plan | None) -> str:
    if not plan:
        return reply
    lines = [f"• {a.title}" + (f" ⛔ {a.blocked_reason}" if a.status == "blocked" else "") for a in plan.actions if a.status in ("proposed", "blocked")]
    return reply + ("\n\n" + "\n".join(lines) if lines else "")


# ------------------------------------------------------------------------- WhatsApp
@router.post("/whatsapp")
async def whatsapp(request: Request, db: Session = Depends(get_db)):
    form = await _form(request, db)
    resp = MessagingResponse()
    sender = (form.get("From") or "").replace("whatsapp:", "")
    shop = _shop_by_phone(db, sender)
    if not shop:
        resp.message("Namaste! Is number se koi Munshi account juda nahi hai. App mein Settings > Shop mein apna WhatsApp number add karein.")
        return _xml(resp)

    body = (form.get("Body") or "").strip()
    try:
        if int(form.get("NumMedia", "0") or 0) > 0:
            ctype, url = form.get("MediaContentType0", ""), form.get("MediaUrl0", "")
            try:
                media = _download(db, url)
            except Exception:
                resp.message("Photo/voice note download nahi ho paaya. Twilio credentials check karein.")
                return _xml(resp)
            if ctype.startswith("audio/"):
                body = groq_client.transcribe(media, "voice.ogg")
            elif ctype.startswith("image/"):
                entries = ocr.scan(db, shop, media, ctype)
                if not entries:
                    resp.message("Photo mein koi udhaar entry samajh nahi aayi. Saaf photo bhejiye.")
                    return _xml(resp)
                plan = Plan(shop_id=shop.id, utterance="[ledger photo]", channel="whatsapp", status="proposed",
                            summary=f"{len(entries)} ledger entries mili.")
                db.add(plan)
                db.flush()
                db.add(Action(plan_id=plan.id, shop_id=shop.id, type="ledger_import", amount=0, status="proposed",
                              title=f"{len(entries)} udhaar entries ledger mein jodein", detail=", ".join(f"{e['name']} ₹{int(e['amount'])}" for e in entries[:8]),
                              payload={"entries": entries}))
                db.commit()
                resp.message(f"Photo se {len(entries)} entries mili:\n" + "\n".join(f"• {e['name']} — ₹{int(e['amount'])}" for e in entries[:12]) +
                             "\n\nLedger mein jodne ke liye 'haan' bhejiye.")
                return _xml(resp)
        result = command.run(db, shop, body, channel="whatsapp")
        text = _plan_text(result["reply"], result["plan"] if result["decision"] is None else None)
        resp.message(text[:1500])
    except groq_client.GroqBusy as e:
        resp.message(f"Munshi abhi busy hai, ~{e.retry_after} second baad dobara bhejiye.")
    except groq_client.GroqUnavailable:
        resp.message("Munshi abhi available nahi hai. Thodi der baad try karein.")
    return _xml(resp)


# ------------------------------------------------------------------------- supplier call
def _play(resp: VoiceResponse, text: str) -> None:
    resp.play(tts.signed_url(text))


def _record(resp: VoiceResponse, action_url: str) -> None:
    resp.record(action=action_url, method="POST", max_length=12, timeout=3, play_beep=False, trim="trim-silence")


def _load_call(db: Session, cs_id: int) -> tuple[CallSession, Action, Shop]:
    cs = db.get(CallSession, cs_id)
    if not cs or not cs.action_id:
        raise HTTPException(404, "call not found")
    action = db.get(Action, cs.action_id)
    return cs, action, db.get(Shop, cs.shop_id)


def _finish(db: Session, shop: Shop, action: Action, cs: CallSession, outcome: dict) -> None:
    cs.status, cs.outcome = "completed", outcome
    if action.status == "executing":
        executor.finish_supplier_order(db, shop, action, outcome, cs.id)
        executor.refresh_plan_status(db.get(Plan, action.plan_id))


@router.post("/voice/supplier")
async def voice_supplier(cs: int, request: Request, db: Session = Depends(get_db)):
    await _form(request, db)
    call, action, shop = _load_call(db, cs)
    line = telephony.opening_line(shop, action)
    call.status = "in_progress"
    call.transcript = [*call.transcript, {"speaker": "munshi", "text": line}]
    db.commit()
    resp = VoiceResponse()
    _play(resp, line)
    _record(resp, f"{get_settings().public_base_url.rstrip('/')}/api/webhooks/voice/supplier/turn?{urlencode({'cs': cs})}")
    return _xml(resp)


@router.post("/voice/supplier/turn")
async def voice_supplier_turn(cs: int, request: Request, db: Session = Depends(get_db)):
    form = await _form(request, db)
    call, action, shop = _load_call(db, cs)
    heard = ""
    url = form.get("RecordingUrl")
    if url:
        try:
            heard = groq_client.transcribe(telephony.download_recording(db, url), "call.mp3")
        except (groq_client.GroqBusy, groq_client.GroqUnavailable, Exception):  # noqa: BLE001
            heard = ""
    call.transcript = [*call.transcript, {"speaker": "supplier", "text": heard or "(unclear)"}]
    silent = sum(1 for t in call.transcript if t["speaker"] == "supplier" and t["text"] == "(unclear)")
    resp = VoiceResponse()
    if silent >= 2:
        resp.say("Maaf kijiye, aawaz saaf nahi aa rahi. Hum baad mein call karenge. Dhanyavaad.", language="hi-IN")
        resp.hangup()
        _finish(db, shop, action, call, {"confirmed": False})
        db.commit()
        return _xml(resp)
    try:
        step = telephony.supplier_turn(shop, action, call, heard)
    except (groq_client.GroqBusy, groq_client.GroqUnavailable):
        step = {"say": "Ek minute, main aapko dobara call karta hoon. Dhanyavaad.", "done": True, "outcome": {"confirmed": False}}
    call.transcript = [*call.transcript, {"speaker": "munshi", "text": step["say"]}]
    _play(resp, step["say"])
    if step["done"]:
        resp.hangup()
        _finish(db, shop, action, call, step["outcome"])
    else:
        _record(resp, f"{get_settings().public_base_url.rstrip('/')}/api/webhooks/voice/supplier/turn?{urlencode({'cs': cs})}")
    db.commit()
    return _xml(resp)


@router.post("/voice/status")
async def voice_status(cs: int, request: Request, db: Session = Depends(get_db)):
    form = await _form(request, db)
    call, action, shop = _load_call(db, cs)
    st = form.get("CallStatus", "")
    if action.status == "executing":  # hung up / never answered before an outcome was recorded
        reason = {"no-answer": "Supplier ne call nahi uthaya.", "busy": "Supplier ka number busy tha.", "failed": "Call lag nahi paayi.",
                  "canceled": "Call cancel ho gayi."}.get(st, "Call bina order confirm hue khatam ho gayi.")
        call.status = "failed"
        action.status, action.result = "failed", {"error": reason, "call_session_id": call.id}
        executor.audit(db, shop, "call_failed", ref=f"action:{action.id}", status=st)
        executor.refresh_plan_status(db.get(Plan, action.plan_id))
    db.commit()
    return Response(status_code=204)


# ------------------------------------------------------------------------- inbound call to Munshi
@router.post("/voice/inbound")
async def voice_inbound(request: Request, db: Session = Depends(get_db)):
    form = await _form(request, db)
    shop = _shop_by_phone(db, form.get("From", ""))
    resp = VoiceResponse()
    if not shop:
        resp.say("Namaste. Yeh number kisi Munshi account se juda nahi hai. Dhanyavaad.", language="hi-IN")
        resp.hangup()
        return _xml(resp)
    _play(resp, "Namaste Raj ji, main Munshi hoon. Bataiye, kya karna hai?")
    _record(resp, f"{get_settings().public_base_url.rstrip('/')}/api/webhooks/voice/inbound/turn?shop={shop.id}")
    return _xml(resp)


@router.post("/voice/inbound/turn")
async def voice_inbound_turn(shop: int, request: Request, db: Session = Depends(get_db)):
    form = await _form(request, db)
    s = db.get(Shop, shop)
    resp = VoiceResponse()
    url = form.get("RecordingUrl")
    try:
        text = groq_client.transcribe(telephony.download_recording(db, url), "call.mp3") if url else ""
        if not text:
            _play(resp, "Maaf kijiye, aawaz saaf nahi aayi. Dobara boliye.")
        else:
            result = command.run(db, s, text, channel="phone")
            spoken = result["reply"]
            if result["decision"] == "approved":
                spoken += " Kuch aur?"
            _play(resp, spoken[:550])
        _record(resp, f"{get_settings().public_base_url.rstrip('/')}/api/webhooks/voice/inbound/turn?shop={shop}")
    except groq_client.GroqBusy:
        _play(resp, "Munshi abhi busy hai, thodi der baad call karein.")
        resp.hangup()
    return _xml(resp)


@router.post("/voice/test")
async def voice_test(request: Request, db: Session = Depends(get_db)):
    await _form(request, db)
    resp = VoiceResponse()
    _play(resp, "Namaste! Yeh Munshi ki test call hai. Aapka Twilio connection sahi kaam kar raha hai. Dhanyavaad.")
    resp.hangup()
    return _xml(resp)
