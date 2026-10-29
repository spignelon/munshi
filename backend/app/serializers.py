from sqlalchemy.orm import Session

from .models import Action, CallSession, Customer, OutboundMessage, Plan, Product, Shop, Supplier, User


def iso(dt):
    return dt.isoformat() + "Z" if dt else None


def user_out(u: User) -> dict:
    return {"id": u.id, "email": u.email, "name": u.name, "phone": u.phone, "role": u.role}


def shop_out(s: Shop) -> dict:
    return {"id": s.id, "name": s.name, "locality": s.locality, "upi_vpa": s.upi_vpa, "whatsapp_number": s.whatsapp_number,
            "language": s.language, "daily_spend_cap": s.daily_spend_cap, "per_order_cap": s.per_order_cap,
            "onboarded": s.onboarded, "demo_loaded": s.demo_loaded}


def _preview(a: Action) -> dict:
    p = dict(a.payload or {})
    if "customers" in p:
        cs = p.pop("customers")
        p["customer_count"] = len(cs)
        p["customer_sample"] = [{"name": c["name"], **({"amount": c["amount"]} if "amount" in c else {})} for c in cs[:5]]
        p.pop("template", None) if a.type != "winback_offer" else None
    return p


def action_out(a: Action) -> dict:
    return {"id": a.id, "plan_id": a.plan_id, "type": a.type, "title": a.title, "detail": a.detail, "amount": a.amount, "status": a.status,
            "blocked_reason": a.blocked_reason, "result": a.result or {}, "simulated": a.simulated, "payload": _preview(a),
            "created_at": iso(a.created_at), "finished_at": iso(a.finished_at)}


def call_out(c: CallSession) -> dict:
    return {"id": c.id, "action_id": c.action_id, "counterpart": c.counterpart, "phone": c.phone, "status": c.status,
            "simulated": c.simulated, "transcript": c.transcript or [], "outcome": c.outcome or {}, "created_at": iso(c.created_at)}


def message_out(m: OutboundMessage) -> dict:
    return {"id": m.id, "action_id": m.action_id, "channel": m.channel, "to": m.to, "recipient_name": m.recipient_name, "body": m.body,
            "status": m.status, "simulated": m.simulated, "error": m.error, "created_at": iso(m.created_at)}


def plan_out(p: Plan, db: Session | None = None, detail: bool = False) -> dict:
    out = {"id": p.id, "utterance": p.utterance, "channel": p.channel, "summary": p.summary, "status": p.status, "created_at": iso(p.created_at),
           "actions": [action_out(a) for a in p.actions],
           "approvals": [{"id": x.id, "decision": x.decision, "channel": x.channel, "utterance": x.utterance, "created_at": iso(x.created_at),
                          "action_ids": x.action_ids} for x in p.approvals]}
    if detail and db is not None:
        ids = [a.id for a in p.actions]
        out["calls"] = [call_out(c) for c in db.query(CallSession).filter(CallSession.action_id.in_(ids)).all()] if ids else []
        msgs = db.query(OutboundMessage).filter(OutboundMessage.action_id.in_(ids)).order_by(OutboundMessage.id).limit(200).all() if ids else []
        out["messages"] = [message_out(m) for m in msgs]
    return out


def customer_out(c: Customer, balance: float = 0.0) -> dict:
    return {"id": c.id, "name": c.name, "phone": c.phone, "last_visit": c.last_visit.isoformat() if c.last_visit else None, "visits": c.visits,
            "lifetime_spend": c.lifetime_spend, "balance": balance, "last_reminded_at": iso(c.last_reminded_at)}


def supplier_out(s: Supplier) -> dict:
    return {"id": s.id, "name": s.name, "phone": s.phone, "categories": s.categories, "notes": s.notes}


def product_out(p: Product, festive: bool = False) -> dict:
    return {"id": p.id, "name": p.name, "category": p.category, "unit": p.unit, "stock": p.stock, "reorder_level": p.reorder_level,
            "unit_cost": p.unit_cost, "price": p.price, "supplier_id": p.supplier_id, "avg_daily_units": p.avg_daily_units,
            "last_festival_units": p.last_festival_units, "incoming_qty": p.incoming_qty, "incoming_eta": p.incoming_eta,
            "festive": festive, "low": p.stock < p.reorder_level}
