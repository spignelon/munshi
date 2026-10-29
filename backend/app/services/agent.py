"""Munshi's brain: one structured planning call per command.

Free-tier budget (8K tokens/min on gpt-oss-120b) rules out multi-round tool loops, so the
read side (sales, udhaar, stock, lapsed regulars) is pre-fetched into a compact snapshot by
deterministic code, and the model makes a single call: understand Raj's Hinglish, reply in
Hinglish, and choose which actions to propose. Quantities, rupee amounts and recipient lists
are then computed by code, and guardrails vet them before Raj is asked.
"""
import re
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from ..models import Action, Message, Plan, Shop
from . import business, groq_client, guardrails

ACTION_TYPES = {"supplier_order", "udhaar_reminders", "winback_offer", "loan_offer", "stock_report"}

SYSTEM = """You are Munshi, the AI business partner of a kirana shop owner (Raj). Speak Hinglish (Hindi in Roman script), warm and brief, like a trusted munshi.
You can PROPOSE these actions; nothing happens until Raj approves:
- supplier_order: phone a supplier and order stock. fields: supplier (name), discount_ask_pct (number 0-8)
- udhaar_reminders: WhatsApp reminders with a Paytm UPI link to customers who owe money. fields: tone ("polite"|"firm")
- winback_offer: WhatsApp an offer to regulars who stopped coming. fields: offer (short offer text, e.g. "Diwali par 10% chhoot")
- loan_offer: present a working-capital loan pre-offer. no fields.
- stock_report: summarise low stock (read-only). no fields.
Rules: propose only what Raj asked for or clearly implied; for questions about sales/stock/udhaar answer from the shop data with NO actions; never invent numbers - use only the shop data; reply max 2 short sentences.
Return ONLY JSON: {"reply": "<Hinglish reply>", "actions": [{"type": "...", ...fields}]}"""

YES = {"haan", "han", "ha", "haa", "hanji", "haanji", "ji", "yes", "yeah", "ok", "okay", "theek", "thik", "hai", "karo", "kar", "do", "dijiye",
       "kijiye", "kardo", "karna", "approve", "approved", "confirm", "pakka", "sahi", "bilkul", "chalo", "done", "y", "👍"}
NO = {"nahi", "nahin", "na", "no", "mat", "cancel", "ruko", "ruk", "reject", "nope", "stop", "n", "rehne", "do"}


def _words(text: str) -> list[str]:
    return re.findall(r"[\w👍]+", text.lower())


def classify_reply(text: str) -> str | None:
    """'yes' / 'no' / None. Strict on purpose: only short utterances made *entirely* of yes/no words count."""
    w = _words(text)
    if not w or len(w) > 5:
        return None
    if any(x in ("nahi", "nahin", "mat", "cancel", "ruko", "reject", "no", "nope", "stop", "rehne") for x in w):
        return "no"
    if all(x in YES for x in w) and any(x in ("haan", "han", "ha", "haa", "hanji", "haanji", "yes", "yeah", "ok", "okay", "theek", "thik", "karo",
                                              "kardo", "approve", "approved", "confirm", "pakka", "bilkul", "chalo", "👍", "y", "dijiye", "kijiye") for x in w):
        return "yes"
    return None


def latest_pending_plan(db: Session, shop: Shop) -> Plan | None:
    cutoff = datetime.utcnow() - timedelta(hours=12)
    return (db.query(Plan).filter(Plan.shop_id == shop.id, Plan.status == "proposed", Plan.created_at >= cutoff)
            .order_by(Plan.id.desc()).first())


def _planner_messages(db: Session, shop: Shop, text: str) -> list:
    return [{"role": "system", "content": SYSTEM},
            {"role": "user", "content": f"SHOP DATA:\n{business.snapshot(db, shop)}\n\nRAJ SAYS: {text}"}]


def _winback_copy(shop: Shop, offer: str) -> str:
    try:
        out = groq_client.chat(
            [{"role": "system", "content": "Write ONE short WhatsApp message in Hinglish (max 35 words) from a kirana shop inviting a lapsed regular back with the given offer. Friendly, no emojis spam (max 1), no placeholders except {name}."},
             {"role": "user", "content": f"Shop: {shop.name}, {shop.locality}. Offer: {offer}"}],
            purpose="winback_copy", max_tokens=200, temperature=0.7)
        if out and "{name}" in out:
            return out
        if out:
            return f"Namaste {{name}} ji! " + out
    except groq_client.GroqBusy:
        pass
    return f"Namaste {{name}} ji! {shop.name} mein {offer}. Aapka intezaar rahega."


def build_actions(db: Session, shop: Shop, plan: Plan, proposals: list[dict]) -> list[Action]:
    out: list[Action] = []
    seen = set()
    for prop in proposals:
        t = prop.get("type")
        if t not in ACTION_TYPES or t in seen:
            continue
        seen.add(t)

        if t == "supplier_order":
            sup = business.find_supplier(db, shop, prop.get("supplier"))
            if not sup:
                continue
            lines = business.festive_order_lines(db, shop, sup.id) or business.reorder_lines(db, shop, sup.id)
            if not lines:
                continue
            total = business.lines_total(lines)
            ask = max(0, min(8, float(prop.get("discount_ask_pct") or 4)))
            out.append(Action(
                plan_id=plan.id, shop_id=shop.id, type=t, amount=total,
                title=f"{sup.name} ko phone karke order — {business.inr(total)} ({len(lines)} items)",
                detail="; ".join(f"{l['name']} ×{l['qty']}" for l in lines[:6]) + ("…" if len(lines) > 6 else ""),
                payload={"supplier_id": sup.id, "supplier_name": sup.name, "phone": sup.phone, "lines": lines,
                         "discount_ask_pct": ask, "total": total}))

        elif t == "udhaar_reminders":
            cutoff = guardrails.cooldown_cutoff()
            cust = [{"id": c.id, "name": c.name, "phone": c.phone, "amount": bal}
                    for c, bal in business.udhaar_balances(db, shop)
                    if c.phone and (c.last_reminded_at is None or c.last_reminded_at < cutoff)]
            total = sum(c["amount"] for c in cust)
            out.append(Action(
                plan_id=plan.id, shop_id=shop.id, type=t, amount=0,
                title=f"{len(cust)} udhaar customers ko WhatsApp + Paytm link — {business.inr(total)} baaki",
                detail="Har customer ko uska hisaab aur UPI pay link bheja jayega.",
                payload={"customers": cust, "tone": prop.get("tone") or "polite", "total": total}))

        elif t == "winback_offer":
            lapsed = [c for c in business.lapsed_customers(db, shop) if c.phone]
            offer = str(prop.get("offer") or f"{business.festival()['name']} par khaas chhoot")[:120]
            copy = _winback_copy(shop, offer)
            out.append(Action(
                plan_id=plan.id, shop_id=shop.id, type=t, amount=0,
                title=f"{len(lapsed)} purane customers ko wapas bulane ka offer",
                detail=copy.replace("{name}", "Aap"),
                payload={"offer": offer, "template": copy, "customers": [{"id": c.id, "name": c.name, "phone": c.phone} for c in lapsed]}))

        elif t == "loan_offer":
            loan = business.loan_offer(db, shop)
            out.append(Action(
                plan_id=plan.id, shop_id=shop.id, type=t, amount=0,
                title=f"Working-capital loan offer — {business.inr(loan['amount'])}",
                detail="Aapki Paytm sales ke basis par pre-approved offer (simulated).", payload=loan))

        elif t == "stock_report":
            lines = business.festive_order_lines(db, shop) or business.reorder_lines(db, shop)
            out.append(Action(
                plan_id=plan.id, shop_id=shop.id, type=t, amount=0,
                title=f"Stock report — {len(lines)} items kam hain",
                detail=", ".join(f"{l['name']} ({int(l['stock'])})" for l in lines[:8]),
                payload={"lines": lines}))
    return out


def propose(db: Session, shop: Shop, text: str, channel: str = "web") -> tuple[Plan, str]:
    """Run the planner and persist a Plan with its proposed Actions."""
    data = groq_client.chat_json(_planner_messages(db, shop, text), purpose="plan", max_tokens=700)
    reply = str(data.get("reply") or "Ji Raj ji.").strip()
    proposals = [a for a in (data.get("actions") or []) if isinstance(a, dict)]

    plan = Plan(shop_id=shop.id, utterance=text, channel=channel, summary=reply, status="proposed")
    db.add(plan)
    db.flush()
    actions = build_actions(db, shop, plan, proposals)
    db.add_all(actions)
    db.flush()

    for a in actions:
        if a.type == "stock_report":  # read-only: nothing moves, so it needs no approval
            a.status, a.result, a.finished_at = "done", {"lines": a.payload["lines"]}, datetime.utcnow()
            continue
        reason = guardrails.check(db, shop, a)
        if reason:
            a.status, a.blocked_reason = "blocked", reason

    movable = [a for a in actions if a.status == "proposed"]
    if not actions:
        plan.status = "executed"  # a pure Q&A turn
    elif not movable:
        plan.status = "executed" if all(a.status == "done" for a in actions) else "blocked"
    db.add(Message(shop_id=shop.id, channel=channel, role="user", text=text, plan_id=plan.id))
    db.add(Message(shop_id=shop.id, channel=channel, role="munshi", text=reply, plan_id=plan.id))
    db.commit()
    return plan, reply
