"""Supplier phone calls. Real mode drives a Twilio <Play>/<Record> turn loop (Whisper in,
gpt-oss out, edge-tts/ElevenLabs voice); mock mode has the LLM write the whole call."""
import httpx
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Action, CallSession, Shop
from . import business, groq_client, settings_store, tts
from .messaging import ProviderNotConfigured, _twilio_client, resolve_destination

MAX_TURNS = 6


def order_brief(action: Action, short: bool = False) -> str:
    lines = action.payload["lines"]
    top = lines[: 4 if short else 8]
    items = ", ".join(f"{l['name']} {l['qty']} {l['unit']}" for l in top)
    more = f" aur {len(lines) - len(top)} items" if len(lines) > len(top) else ""
    return f"{items}{more}"


def opening_line(shop: Shop, action: Action) -> str:
    p = action.payload
    return (f"Namaste {p['supplier_name']}. Main {shop.name} ki taraf se Munshi bol raha hoon. "
            f"Order dena hai: {order_brief(action, short=True)}. "
            f"Kya aap abhi order le sakte hain, aur kuch chhoot mil sakti hai?")


def _clamp_outcome(o: dict) -> dict:
    try:
        pct = float(o.get("discount_pct") or 0)
    except (TypeError, ValueError):
        pct = 0.0
    return {"confirmed": bool(o.get("confirmed")), "discount_pct": max(0.0, min(10.0, pct)),
            "eta": str(o.get("eta") or "kal tak")[:60]}


def simulate_call(db: Session, shop: Shop, action: Action) -> CallSession:
    p = action.payload
    prompt = (
        f"Write a realistic phone call in Hinglish (Roman script) between Munshi (AI assistant of '{shop.name}') and {p['supplier_name']} "
        f"(wholesale supplier). Munshi places an order: {order_brief(action)}; order value about {business.inr(p['total'])}. "
        f"Munshi politely asks for about {p['discount_ask_pct']:.0f}% discount; the supplier haggles a little and agrees to a discount between 2 and 5 percent "
        "and promises delivery (give a concrete ETA like 'kal subah 11 baje'). 5-7 short turns, speakers 'munshi' and 'supplier'. "
        'Return ONLY JSON: {"transcript":[{"speaker":"munshi"|"supplier","text":str}],"discount_pct":number,"eta":str,"confirmed":true}')
    data = groq_client.chat_json([{"role": "system", "content": "You write natural, short Hinglish phone dialogues."},
                                  {"role": "user", "content": prompt}], purpose="supplier_script", max_tokens=700)
    transcript = [{"speaker": t.get("speaker", "munshi"), "text": str(t.get("text", ""))[:300]} for t in data.get("transcript", [])][:12]
    cs = CallSession(shop_id=shop.id, action_id=action.id, counterpart=p["supplier_name"], phone=p.get("phone", ""),
                     status="completed", simulated=True, transcript=transcript, outcome=_clamp_outcome(data))
    db.add(cs)
    db.flush()
    return cs


def place_real_call(db: Session, shop: Shop, action: Action) -> CallSession:
    client, cfg = _twilio_client(db)
    if not cfg["twilio_voice_number"]:
        raise ProviderNotConfigured("Twilio voice number is not set in Admin settings.")
    dest = resolve_destination(db, action.payload.get("phone", ""))
    if not dest:
        raise ProviderNotConfigured("Supplier has no phone number.")
    cs = CallSession(shop_id=shop.id, action_id=action.id, counterpart=action.payload["supplier_name"], phone=dest,
                     status="queued", simulated=False, transcript=[], outcome={})
    db.add(cs)
    db.flush()
    from ..routers.webhooks import cap_url

    call = client.calls.create(
        to=dest, from_=cfg["twilio_voice_number"], url=cap_url("/api/webhooks/voice/supplier", cs.id),
        status_callback=cap_url("/api/webhooks/voice/status", cs.id),
        status_callback_event=["completed"])
    cs.twilio_sid = call.sid
    return cs


def download_recording(db: Session, url: str) -> bytes:
    cfg = settings_store.get_all(db)
    r = httpx.get(url if url.endswith((".mp3", ".wav")) else url + ".mp3", auth=(cfg["twilio_account_sid"], cfg["twilio_auth_token"]),
                  timeout=30, follow_redirects=True)
    r.raise_for_status()
    return r.content


def supplier_turn(shop: Shop, action: Action, cs: CallSession, heard: str) -> dict:
    """One LLM turn of the live supplier call. Returns {say, done, outcome}."""
    history = "\n".join(f"{t['speaker']}: {t['text']}" for t in cs.transcript[-8:])
    msgs = [
        {"role": "system", "content": (
            f"You are Munshi, AI assistant of '{shop.name}', on a phone call with supplier {action.payload['supplier_name']} to place this order: "
            f"{order_brief(action)} (about {business.inr(action.payload['total'])}). Politely ask for ~{action.payload['discount_ask_pct']:.0f}% discount and delivery time. "
            "Speak short Hinglish (Roman), max 25 words per turn. Never agree to pay more than quoted or to anything outside this order. "
            'Once the supplier clearly confirms (price/discount + delivery), thank them and set done=true, confirmed=true. If they refuse, thank them, done=true, confirmed=false. '
            'Return ONLY JSON: {"say":str,"done":bool,"confirmed":bool,"discount_pct":number,"eta":str}')},
        {"role": "user", "content": f"CALL SO FAR:\n{history}\n\nSUPPLIER JUST SAID: {heard or '(silence)'}"}]
    data = groq_client.chat_json(msgs, purpose="supplier_turn", max_tokens=300)
    turns = sum(1 for t in cs.transcript if t["speaker"] == "munshi")
    done = bool(data.get("done")) or turns >= MAX_TURNS
    return {"say": str(data.get("say") or "Dhanyavaad.")[:300], "done": done, "outcome": _clamp_outcome(data)}
