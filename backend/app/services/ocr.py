"""Notebook-photo -> draft udhaar rows via qwen vision. Nothing is saved until the owner reviews and imports."""
import difflib

from sqlalchemy.orm import Session

from ..models import Customer, Shop
from . import groq_client

PROMPT = (
    "This is a photo of a kirana shop's handwritten udhaar (credit) notebook page, in Hindi/English/Hinglish. "
    "Extract every row that has a person's name and a rupee amount owed. Transliterate names to Roman script. "
    'Return ONLY JSON: {"entries":[{"name": string, "amount": number, "note": string}]}. '
    "Amounts are plain rupee numbers. note = items bought if written, else empty. Skip rows you cannot read."
)


def scan(db: Session, shop: Shop, image: bytes, mime: str) -> list[dict]:
    data = groq_client.vision_json(image, mime, PROMPT)
    existing = db.query(Customer).filter(Customer.shop_id == shop.id).all()
    by_name = {c.name.lower(): c for c in existing}
    out = []
    for e in (data.get("entries") or [])[:60]:
        try:
            amount = float(str(e.get("amount", 0)).replace(",", "").replace("₹", "").replace("Rs", "").strip())
        except ValueError:
            continue
        name = str(e.get("name") or "").strip()
        if not name or amount <= 0:
            continue
        match = by_name.get(name.lower())
        if not match:
            close = difflib.get_close_matches(name.lower(), list(by_name), n=1, cutoff=0.85)
            match = by_name[close[0]] if close else None
        out.append({"name": match.name if match else name, "customer_id": match.id if match else None, "amount": amount,
                    "note": str(e.get("note") or "")[:120], "matched": bool(match)})
    return out
