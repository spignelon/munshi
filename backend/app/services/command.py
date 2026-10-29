"""One entry point for every channel (web, WhatsApp, phone): text in -> Munshi's reply out.
A short 'haan' / 'yes' / 'nahi' while a plan is pending approves / rejects it."""
from sqlalchemy.orm import Session

from ..models import Message, Plan, Shop
from . import agent, executor


def run(db: Session, shop: Shop, text: str, channel: str = "web", actor: str = "owner") -> dict:
    text = (text or "").strip()
    if not text:
        return {"reply": "Kuch sunai nahi diya. Dobara bataiye?", "plan": None, "decision": None}

    verdict = agent.classify_reply(text)
    pending = agent.latest_pending_plan(db, shop) if verdict else None
    if pending and verdict:
        db.add(Message(shop_id=shop.id, channel=channel, role="user", text=text, plan_id=pending.id))
        if verdict == "yes":
            executor.decide(db, shop, pending, approve=True, channel=channel, utterance=text, actor=actor)
            reply = "Ji, kar diya. " + executor.summarize(pending)
            decision = "approved"
        else:
            executor.decide(db, shop, pending, approve=False, channel=channel, utterance=text, actor=actor)
            reply = "Theek hai, maine kuch nahi kiya. Plan cancel kar diya."
            decision = "rejected"
        db.add(Message(shop_id=shop.id, channel=channel, role="munshi", text=reply, plan_id=pending.id))
        db.commit()
        return {"reply": reply, "plan": pending, "decision": decision}

    plan, reply = agent.propose(db, shop, text, channel)
    movable = [a for a in plan.actions if a.status == "proposed"]
    if movable:
        reply = f"{reply} Approve karne ke liye 'haan' boliye."
    return {"reply": reply, "plan": plan, "decision": None}
