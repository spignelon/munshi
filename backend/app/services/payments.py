"""UPI pay links. A short https link opens a mobile page whose button fires the
upi:// deep link (WhatsApp does not reliably linkify upi:// itself)."""
import secrets
from urllib.parse import quote

from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Customer, PayLink, Shop


def upi_uri(vpa: str, shop_name: str, amount: float, note: str) -> str:
    return f"upi://pay?pa={quote(vpa)}&pn={quote(shop_name)}&am={amount:.2f}&cu=INR&tn={quote(note)}"


def make_link(db: Session, shop: Shop, customer: Customer | None, amount: float) -> str:
    code = secrets.token_urlsafe(6).replace("-", "a").replace("_", "b")[:8]
    uri = upi_uri(shop.upi_vpa or "merchant@paytm", shop.name, amount, f"Udhaar {customer.name if customer else ''}".strip())
    db.add(PayLink(code=code, shop_id=shop.id, customer_id=customer.id if customer else None, amount=amount,
                   upi_uri=uri, shop_name=shop.name))
    return f"{get_settings().public_base_url.rstrip('/')}/api/pay/{code}"
