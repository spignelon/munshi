"""Executes approved actions. Nothing here runs without an Approval record."""
import hashlib
from datetime import datetime

from sqlalchemy.orm import Session

from ..models import (Action, AuditLog, Approval, CallSession, Customer, Plan, Product, Shop, UdhaarEntry)
from . import business, guardrails, messaging, payments, settings_store, telephony

TEST_MODE_CAP = 3  # real mode + redirect number: don't spam one phone with 41 copies


def audit(db: Session, shop: Shop, event: str, ref: str = "", actor: str = "munshi", **detail):
    db.add(AuditLog(shop_id=shop.id, actor=actor, event=event, ref=ref, detail=detail))


def decide(db: Session, shop: Shop, plan: Plan, *, approve: bool, action_ids: list[int] | None = None,
           channel: str = "web", utterance: str = "", actor: str = "owner") -> Plan:
    if plan.status != "proposed":
        raise ValueError(f"Plan already {plan.status}")
    pending = [a for a in plan.actions if a.status in ("proposed", "blocked")]
    chosen = [a for a in pending if a.status == "proposed" and (action_ids is None or a.id in action_ids)]
    appr = Approval(plan_id=plan.id, shop_id=shop.id, decision="approved" if approve and chosen else "rejected", channel=channel,
                    utterance=utterance[:290] or ("approved" if approve else "rejected"), action_ids=[a.id for a in chosen])
    db.add(appr)
    db.flush()
    audit(db, shop, f"plan_{appr.decision}", ref=f"plan:{plan.id}", actor=actor, channel=channel, approval_id=appr.id, actions=appr.action_ids)

    for a in pending:
        if a not in chosen or not approve:
            a.status = "rejected" if a.status == "proposed" else a.status
    if not approve or not chosen:
        plan.status = "rejected"
        db.commit()
        return plan

    mock = settings_store.is_mock(db)
    for a in chosen:
        a.approval_id = appr.id
        a.status = "approved"
        a.simulated = mock or a.type == "loan_offer"
        reason = guardrails.check(db, shop, a, require_approval=True)
        if reason:
            a.status, a.blocked_reason = "blocked", reason
            audit(db, shop, "action_blocked", ref=f"action:{a.id}", reason=reason)
            continue
        try:
            _run(db, shop, a, mock)
        except Exception as e:  # noqa: BLE001 - a failed provider must not take the whole plan down
            a.status, a.result, a.finished_at = "failed", {"error": str(e)[:300]}, datetime.utcnow()
            audit(db, shop, "action_failed", ref=f"action:{a.id}", error=str(e)[:300])
    refresh_plan_status(plan)
    db.commit()
    return plan


def refresh_plan_status(plan: Plan) -> None:
    sts = [a.status for a in plan.actions]
    if any(s in ("executing", "approved") for s in sts):
        plan.status = "approved"
    elif sts and all(s in ("done",) for s in sts):
        plan.status = "executed"
    elif any(s == "done" for s in sts):
        plan.status = "partial"
    elif any(s in ("failed", "blocked") for s in sts):
        plan.status = "failed"


def _run(db: Session, shop: Shop, a: Action, mock: bool) -> None:
    a.status = "executing"
    handler = {"supplier_order": _supplier_order, "udhaar_reminders": _udhaar_reminders, "winback_offer": _winback,
               "loan_offer": _loan_offer, "ledger_import": _ledger_import}[a.type]
    handler(db, shop, a, mock)
    if a.status == "done":
        a.finished_at = datetime.utcnow()
    audit(db, shop, f"action_{a.status}", ref=f"action:{a.id}", type=a.type, simulated=a.simulated)


# -- supplier order -----------------------------------------------------------------------------
def _supplier_order(db: Session, shop: Shop, a: Action, mock: bool) -> None:
    if mock:
        cs = telephony.simulate_call(db, shop, a)
        finish_supplier_order(db, shop, a, cs.outcome, cs.id)
    else:
        cs = telephony.place_real_call(db, shop, a)  # stays 'executing' until the webhooks finish the call
        a.result = {"call_session_id": cs.id, "call_sid": cs.twilio_sid, "state": "calling"}


def finish_supplier_order(db: Session, shop: Shop, a: Action, outcome: dict, call_session_id: int | None = None) -> None:
    total = float(a.payload["total"])
    if not outcome.get("confirmed"):
        a.status, a.finished_at = "failed", datetime.utcnow()
        a.result = {"error": "Supplier ne order confirm nahi kiya.", "call_session_id": call_session_id}
        audit(db, shop, "supplier_declined", ref=f"action:{a.id}")
        return
    pct = float(outcome.get("discount_pct") or 0)
    disc = round(total * pct / 100)
    final = total - disc
    eta = outcome.get("eta", "")
    for l in a.payload["lines"]:
        prod = db.get(Product, l["product_id"])
        if prod:
            prod.incoming_qty += l["qty"]
            prod.incoming_eta = eta
    a.amount = final
    a.status, a.finished_at = "done", datetime.utcnow()
    a.result = {"confirmed": True, "discount_pct": pct, "discount_amount": disc, "gross": total, "final_amount": final, "eta": eta,
                "supplier": a.payload["supplier_name"], "order_ref": f"MUN-{a.id:05d}", "call_session_id": call_session_id}
    audit(db, shop, "supplier_order_confirmed", ref=f"action:{a.id}", final=final, discount=disc)


# -- udhaar reminders & win-back ------------------------------------------------------------------
def _recipients(db: Session, a: Action, mock: bool) -> list[dict]:
    cust = a.payload["customers"]
    if not mock and settings_store.get(db, "test_redirect_number").strip():
        return cust[:TEST_MODE_CAP]
    return cust


def _udhaar_reminders(db: Session, shop: Shop, a: Action, mock: bool) -> None:
    sent = failed = 0
    recovered = 0.0
    first_error = ""
    for c in _recipients(db, a, mock):
        cust = db.get(Customer, c["id"])
        link = payments.make_link(db, shop, cust, c["amount"])
        body = (f"Namaste {c['name'].split()[0]} ji 🙏 {shop.name} se. Aapka ₹{int(c['amount']):,} baaki hai. "
                f"Is link se UPI/Paytm se chuka sakte hain: {link}\nDhanyavaad!")
        m = messaging.send_whatsapp(db, shop, to=c["phone"], body=body, recipient_name=c["name"], customer_id=c["id"], action_id=a.id)
        if m.status == "sent":
            sent += 1
            if cust:
                cust.last_reminded_at = datetime.utcnow()
            if mock and _pays_back(c["id"]):
                recovered += c["amount"]
                db.add(UdhaarEntry(shop_id=shop.id, customer_id=c["id"], amount=c["amount"], kind="payment", note="Paytm link se (simulated)",
                                   source="mock-payment", simulated=True))
        else:
            failed += 1
            first_error = first_error or m.error
    a.result = {"sent": sent, "failed": failed, "requested": a.payload["total"], "recovered_simulated": recovered,
                "capped_for_test": (not mock) and len(a.payload["customers"]) > len(_recipients(db, a, mock))}
    _finish_messaging(a, sent, failed, first_error)


def _pays_back(customer_id: int) -> bool:
    """Deterministic ~25% of customers 'pay by lunch' in mock mode."""
    return int(hashlib.md5(f"pay{customer_id}".encode()).hexdigest(), 16) % 100 < 25


def _winback(db: Session, shop: Shop, a: Action, mock: bool) -> None:
    sent = failed = 0
    first_error = ""
    for c in _recipients(db, a, mock):
        body = a.payload["template"].replace("{name}", c["name"].split()[0])
        m = messaging.send_whatsapp(db, shop, to=c["phone"], body=body, recipient_name=c["name"], customer_id=c["id"], action_id=a.id)
        if m.status == "sent":
            sent += 1
        else:
            failed += 1
            first_error = first_error or m.error
    a.result = {"sent": sent, "failed": failed, "offer": a.payload["offer"]}
    _finish_messaging(a, sent, failed, first_error)


def _finish_messaging(a: Action, sent: int, failed: int, first_error: str) -> None:
    if sent == 0 and failed:
        a.status, a.finished_at = "failed", datetime.utcnow()
        a.result["error"] = first_error or "Messages send nahi ho paaye."
    else:
        a.status = "done"


# -- loan offer & ledger import ---------------------------------------------------------------------
def _loan_offer(db: Session, shop: Shop, a: Action, mock: bool) -> None:
    p = a.payload
    text = (f"Aapki Paytm sales ke basis par {business.inr(p['amount'])} ka working-capital loan pre-approved hai "
            f"({p['tenure_months']} mahine). [Simulated offer — demo only]")
    sent = False
    if shop.whatsapp_number:
        m = messaging.send_whatsapp(db, shop, to=shop.whatsapp_number, body=text, recipient_name="Owner", action_id=a.id, direct=True)
        sent = m.status == "sent"
    a.result = {"offer_amount": p["amount"], "tenure_months": p["tenure_months"], "whatsapp_sent": sent, "note": p["note"]}
    a.status = "done"


def _ledger_import(db: Session, shop: Shop, a: Action, mock: bool) -> None:
    n = import_entries(db, shop, a.payload["entries"], source="ocr")
    a.result = {"imported": n}
    a.status = "done"


def import_entries(db: Session, shop: Shop, entries: list[dict], source: str = "ocr") -> int:
    n = 0
    for e in entries:
        amount = float(e.get("amount") or 0)
        if amount <= 0:
            continue
        cust = db.get(Customer, e["customer_id"]) if e.get("customer_id") else None
        if cust and cust.shop_id != shop.id:
            cust = None
        if not cust:
            name = str(e.get("name") or "").strip()[:150]
            if not name:
                continue
            cust = Customer(shop_id=shop.id, name=name, phone=str(e.get("phone") or "")[:30], visits=1)
            db.add(cust)
            db.flush()
        db.add(UdhaarEntry(shop_id=shop.id, customer_id=cust.id, amount=amount, kind=e.get("kind") or "credit",
                           note=str(e.get("note") or "")[:290], source=source))
        n += 1
    return n


# -- natural-language summary of what happened ---------------------------------------------------------
def summarize(plan: Plan) -> str:
    parts = []
    for a in plan.actions:
        r = a.result or {}
        if a.status == "done" and a.type == "supplier_order":
            parts.append(f"{r['supplier']} se order pakka: {business.inr(r['final_amount'])}, {r['discount_pct']:.0f}% chhoot ({business.inr(r['discount_amount'])} bacha), maal {r['eta']}.")
        elif a.status == "done" and a.type == "udhaar_reminders":
            extra = f" {business.inr(r['recovered_simulated'])} wapas aa gaye." if r.get("recovered_simulated") else ""
            parts.append(f"{r['sent']} customers ko udhaar reminder bheje.{extra}")
        elif a.status == "done" and a.type == "winback_offer":
            parts.append(f"{r['sent']} purane customers ko offer bheja.")
        elif a.status == "done" and a.type == "loan_offer":
            parts.append(f"{business.inr(r['offer_amount'])} ka loan offer ready hai.")
        elif a.status == "done" and a.type == "ledger_import":
            parts.append(f"{r['imported']} ledger entries add ho gayi.")
        elif a.status == "executing" and a.type == "supplier_order":
            parts.append(f"{a.payload['supplier_name']} ko call lag raha hai…")
        elif a.status in ("failed", "blocked"):
            parts.append(f"{a.title.split(' —')[0]}: nahi ho paaya — {(a.blocked_reason or r.get('error', ''))}")
    return " ".join(parts) or "Ho gaya."
