"""Fixed approval rules. The agent proposes; these rules decide. They run when an
action is proposed (to warn the owner early) and again, authoritatively, at execution."""
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from ..models import Action, Shop
from . import business

MAX_RECIPIENTS = 200
REMIND_COOLDOWN_HOURS = 48
MONEY_ACTIONS = {"supplier_order"}


def check(db: Session, shop: Shop, action: Action, *, require_approval: bool = False) -> str | None:
    """Returns a human-readable block reason, or None if the action may proceed."""
    if require_approval and action.type != "stock_report" and not action.approval_id:
        return "Owner ki approval ke bina kuch nahi hoga (no approval on record)."

    if action.type in MONEY_ACTIONS:
        if action.amount > shop.per_order_cap:
            return (f"Order {business.inr(action.amount)} hai, jo per-order limit {business.inr(shop.per_order_cap)} se zyada hai. "
                    "Settings mein limit badha sakte hain.")
        already = business.spent_today(db, shop)
        if action.status in ("approved", "executing", "done"):
            already -= action.amount  # don't double count the action being checked
        if already + action.amount > shop.daily_spend_cap:
            return (f"Aaj ka kharch {business.inr(already + action.amount)} ho jayega, daily limit {business.inr(shop.daily_spend_cap)} hai "
                    f"(aaj pehle se {business.inr(already)}).")

    if action.type in ("udhaar_reminders", "winback_offer"):
        n = len(action.payload.get("customers", []))
        if n == 0:
            return "Koi eligible customer nahi mila (phone number ya cooldown check)."
        if n > MAX_RECIPIENTS:
            return f"Ek baar mein {MAX_RECIPIENTS} se zyada messages allowed nahi hain."
    return None


def cooldown_cutoff() -> datetime:
    return datetime.utcnow() - timedelta(hours=REMIND_COOLDOWN_HOURS)
