"""WhatsApp via the Twilio sandbox. In mock mode messages are only recorded (tagged simulated)."""
import json

from sqlalchemy.orm import Session

from ..models import OutboundMessage, Shop
from . import settings_store, tts


class ProviderNotConfigured(Exception):
    pass


def resolve_destination(db: Session, phone: str) -> str:
    """Real mode safety net: an admin 'test redirect number' overrides every customer/supplier number."""
    redirect = settings_store.get(db, "test_redirect_number").strip()
    return redirect or phone


def _twilio_client(db: Session):
    from twilio.rest import Client

    cfg = settings_store.get_all(db)
    if not (cfg["twilio_account_sid"] and cfg["twilio_auth_token"]):
        raise ProviderNotConfigured("Twilio is not configured. Add the Account SID and Auth Token in Admin settings, or turn Mock mode on.")
    return Client(cfg["twilio_account_sid"], cfg["twilio_auth_token"]), cfg


def _content_args(cfg: dict, body: str) -> dict:
    """Free-text body, or the configured approved template with Munshi's text injected into its variables."""
    sid = (cfg.get("twilio_whatsapp_content_sid") or "").strip()
    if not sid:
        return {"body": body}
    flat = " ".join(body.split())[:900]  # variables can't hold newlines/tabs/runs of spaces
    raw = cfg.get("twilio_whatsapp_content_vars") or '{"1": "{text}"}'
    try:
        variables = {k: str(v).replace("{text}", flat) for k, v in json.loads(raw).items()}
    except (ValueError, AttributeError):
        variables = {"1": flat}
    return {"content_sid": sid, "content_variables": json.dumps(variables, ensure_ascii=False)}


def _friendly(err: str) -> str:
    if "ContentSid Required" in err:
        return ("Twilio ne free-text WhatsApp nahi bheja: is account par sirf approved template chalta hai. "
                "Admin > Twilio mein 'WhatsApp template SID' (HX…) daalein.")
    return err


def send_whatsapp(db: Session, shop: Shop, *, to: str, body: str, recipient_name: str = "", customer_id: int | None = None,
                  action_id: int | None = None, direct: bool = False) -> OutboundMessage:
    """direct=True sends to `to` as-is (used for messages to the owner himself); otherwise the test redirect applies."""
    mock = settings_store.is_mock(db)
    msg = OutboundMessage(shop_id=shop.id, action_id=action_id, customer_id=customer_id, channel="whatsapp",
                          to=to, recipient_name=recipient_name, body=body, simulated=mock)
    if mock:
        msg.status = "sent"
    else:
        try:
            client, cfg = _twilio_client(db)
            dest = to if direct else resolve_destination(db, to)
            if not dest:
                raise ProviderNotConfigured("No destination phone number.")
            sent = client.messages.create(from_=cfg["twilio_whatsapp_from"], to=f"whatsapp:{dest.replace('whatsapp:', '')}",
                                          **_content_args(cfg, body))
            msg.provider_sid = sent.sid
            msg.status = "sent"
            msg.to = dest
        except Exception as e:  # noqa: BLE001 - surface any provider error on the record
            msg.status = "failed"
            msg.error = _friendly(str(e))[:290]
    db.add(msg)
    return msg


def place_voice_message(db: Session, shop: Shop, *, to: str, text: str, recipient_name: str = "", customer_id: int | None = None,
                        action_id: int | None = None) -> OutboundMessage:
    """One-way phone call that plays `text` as speech (TTS provider from Admin). The text is stored on the record and served by
    /api/webhooks/voice/message?m=<id>. In mock mode the call is only recorded."""
    from ..config import get_settings

    mock = settings_store.is_mock(db)
    msg = OutboundMessage(shop_id=shop.id, action_id=action_id, customer_id=customer_id, channel="call",
                          to=to, recipient_name=recipient_name, body=text, simulated=mock)
    db.add(msg)
    db.flush()
    if mock:
        msg.status = "sent"
        return msg
    try:
        client, cfg = _twilio_client(db)
        if not cfg["twilio_voice_number"]:
            raise ProviderNotConfigured("Twilio voice number is not set in Admin settings.")
        dest = resolve_destination(db, to)
        if not dest:
            raise ProviderNotConfigured("No destination phone number.")
        base = get_settings().public_base_url.rstrip("/")
        call = client.calls.create(to=dest, from_=cfg["twilio_voice_number"], url=f"{base}/api/webhooks/voice/message?m={msg.id}&k={tts.cap_token('/api/webhooks/voice/message', str(msg.id))}")
        msg.provider_sid, msg.status, msg.to = call.sid, "sent", dest
    except Exception as e:  # noqa: BLE001
        msg.status, msg.error = "failed", str(e)[:290]
    return msg
