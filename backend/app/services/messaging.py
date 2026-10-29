"""WhatsApp via the Twilio sandbox. In mock mode messages are only recorded (tagged simulated)."""
from sqlalchemy.orm import Session

from ..models import OutboundMessage, Shop
from . import settings_store


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
            sent = client.messages.create(from_=cfg["twilio_whatsapp_from"], to=f"whatsapp:{dest.replace('whatsapp:', '')}", body=body)
            msg.provider_sid = sent.sid
            msg.status = "sent"
            msg.to = dest
        except Exception as e:  # noqa: BLE001 - surface any provider error on the record
            msg.status = "failed"
            msg.error = str(e)[:290]
    db.add(msg)
    return msg
