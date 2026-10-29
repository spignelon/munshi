"""Evening brief: what happened today, in Hinglish. Deterministic (no LLM tokens)."""
from datetime import date, datetime

from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import clock
from ..models import Brief, OutboundMessage, Product, Shop, UdhaarEntry
from . import business, messaging


def build(db: Session, shop: Shop, send: bool = False) -> Brief:
    today = clock.today()
    start = clock.day_start_utc()
    sm = business.sales_summary(db, shop)
    recovered = float(db.query(func.coalesce(func.sum(UdhaarEntry.amount), 0))
                      .filter(UdhaarEntry.shop_id == shop.id, UdhaarEntry.kind == "payment", UdhaarEntry.created_at >= start).scalar() or 0)
    reminders = db.query(OutboundMessage).filter(OutboundMessage.shop_id == shop.id, OutboundMessage.created_at >= start,
                                                 OutboundMessage.action_id != None).count()  # noqa: E711
    incoming = db.query(Product).filter(Product.shop_id == shop.id, Product.incoming_qty > 0).all()
    low = db.query(Product).filter(Product.shop_id == shop.id, Product.stock < Product.reorder_level).count()
    owed = business.udhaar_total(db, shop)

    parts = [f"Aaj ka hisaab: {business.inr(sm['today'])} ki sales, {sm['today_payments']} payments."]
    if recovered:
        parts.append(f"Udhaar mein {business.inr(recovered)} wapas aaya.")
    parts.append(f"Abhi {business.inr(owed)} udhaar baaki hai.")
    if incoming:
        eta = next((p.incoming_eta for p in incoming if p.incoming_eta), "jaldi")
        parts.append(f"{len(incoming)} items ka naya stock aa raha hai — {eta}.")
    if low:
        parts.append(f"{low} items abhi bhi kam hain.")
    text = " ".join(parts)
    stats = {"sales_today": sm["today"], "payments": sm["today_payments"], "recovered_today": recovered, "udhaar_outstanding": owed,
             "incoming_items": len(incoming), "low_stock_items": low, "messages_sent": reminders}

    brief = db.query(Brief).filter(Brief.shop_id == shop.id, Brief.day == today).first()
    if brief:
        brief.text, brief.stats = text, stats
    else:
        brief = Brief(shop_id=shop.id, day=today, text=text, stats=stats)
        db.add(brief)
    if send and shop.whatsapp_number:
        m = messaging.send_whatsapp(db, shop, to=shop.whatsapp_number, body=text, recipient_name="Owner", direct=True)
        brief.sent = m.status == "sent"
    db.commit()
    return brief
