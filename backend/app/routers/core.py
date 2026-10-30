import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import seed
from ..auth import current_shop, current_user, hash_password, make_token, verify_password
from ..config import get_settings
from ..db import get_db
from ..models import Brief, Plan, Product, Shop, User
from ..serializers import plan_out, shop_out, user_out
from ..services import brief as brief_service
from ..services import business, groq_client, settings_store

router = APIRouter(prefix="/api")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def norm_phone(p: str) -> str:
    p = re.sub(r"[^\d+]", "", p or "")
    if not p:
        return ""
    if p.startswith("+"):
        return p
    if len(p) == 10:
        return "+91" + p
    if len(p) == 12 and p.startswith("91"):
        return "+" + p
    return "+" + p


def session_out(user: User, shop: Shop, db: Session) -> dict:
    return {"user": user_out(user), "shop": shop_out(shop), "mock_mode": settings_store.is_mock(db)}


class SignupIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: str
    password: str = Field(min_length=8, max_length=72)
    phone: str = ""
    shop_name: str = ""


class LoginIn(BaseModel):
    email: str
    password: str


@router.post("/auth/signup")
def signup(body: SignupIn, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(422, "Valid email daaliye.")
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(409, "Is email se account pehle se hai. Login karein.")
    user = User(email=email, name=body.name.strip(), phone=norm_phone(body.phone), password_hash=hash_password(body.password))
    db.add(user)
    db.flush()
    shop = Shop(owner_id=user.id, name=body.shop_name.strip() or f"{body.name.strip()} Kirana", whatsapp_number=norm_phone(body.phone))
    db.add(shop)
    db.commit()
    return {"token": make_token(user), **session_out(user, shop, db)}


@router.post("/auth/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == body.email.strip().lower()).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Email ya password galat hai.")
    shop = db.query(Shop).filter(Shop.owner_id == user.id).first()
    return {"token": make_token(user), **session_out(user, shop, db)}


@router.post("/auth/demo")
def demo_login(db: Session = Depends(get_db)):
    s = get_settings()
    user = db.query(User).filter(User.email == s.demo_email.lower()).first()
    if not user:  # only on a brand-new database; normally init_db() already created it at startup
        seed.bootstrap(db)
        user = db.query(User).filter(User.email == s.demo_email.lower()).one()
    shop = db.query(Shop).filter(Shop.owner_id == user.id).one()
    if not shop.demo_loaded:
        seed.seed_demo(db, shop)
        db.refresh(shop)
    return {"token": make_token(user), **session_out(user, shop, db)}


@router.get("/auth/me")
def me(user: User = Depends(current_user), shop: Shop = Depends(current_shop), db: Session = Depends(get_db)):
    return session_out(user, shop, db)


class ShopIn(BaseModel):
    name: str | None = Field(default=None, max_length=150)
    locality: str | None = Field(default=None, max_length=150)
    upi_vpa: str | None = Field(default=None, max_length=100)
    whatsapp_number: str | None = None
    daily_spend_cap: float | None = Field(default=None, ge=0, le=10_000_000)
    per_order_cap: float | None = Field(default=None, ge=0, le=10_000_000)
    onboarded: bool | None = None


@router.put("/shop")
def update_shop(body: ShopIn, shop: Shop = Depends(current_shop), db: Session = Depends(get_db)):
    data = body.model_dump(exclude_none=True)
    if "whatsapp_number" in data:
        data["whatsapp_number"] = norm_phone(data["whatsapp_number"])
    if "upi_vpa" in data and data["upi_vpa"] and not re.match(r"^[\w.\-]{2,}@[A-Za-z]{2,}$", data["upi_vpa"]):
        raise HTTPException(422, "UPI ID sahi format mein daaliye (jaise name@paytm).")
    for k, v in data.items():
        setattr(shop, k, v)
    db.commit()
    return shop_out(shop)


@router.post("/shop/demo-data")
def load_demo(shop: Shop = Depends(current_shop), db: Session = Depends(get_db)):
    stats = seed.seed_demo(db, shop)
    return {"shop": shop_out(shop), "stats": stats}


@router.get("/dashboard")
def dashboard(shop: Shop = Depends(current_shop), db: Session = Depends(get_db)):
    sm = business.sales_summary(db, shop)
    bal = business.udhaar_balances(db, shop)
    sup = business.find_supplier(db, shop, None)
    festive = business.festive_order_lines(db, shop, sup.id) if sup else []
    low_count = db.query(Product).filter(Product.shop_id == shop.id, Product.stock < Product.reorder_level).count()
    pending = (db.query(Plan).filter(Plan.shop_id == shop.id, Plan.status == "proposed").order_by(Plan.id.desc()).limit(5).all())
    brief = db.query(Brief).filter(Brief.shop_id == shop.id).order_by(Brief.id.desc()).first()
    return {
        "shop": shop_out(shop),
        "festival": business.festival(),
        "sales": sm,
        "udhaar": {"total": sum(b for _, b in bal), "count": len(bal),
                   "top": [{"id": c.id, "name": c.name, "balance": b} for c, b in bal[:5]]},
        "stock": {"low_count": low_count, "festive_low_count": len(festive), "festive_order_total": business.lines_total(festive),
                  "festive_supplier": sup.name if sup else None},
        "lapsed_count": len(business.lapsed_customers(db, shop)),
        "pending_plans": [plan_out(p) for p in pending],
        "brief": {"text": brief.text, "day": brief.day.isoformat(), "stats": brief.stats, "sent": brief.sent} if brief else None,
        "loan": business.loan_offer(db, shop),
        "groq": {"configured": bool(get_settings().groq_api_key or get_settings().groq_fake)},
    }


@router.post("/brief")
def make_brief(shop: Shop = Depends(current_shop), db: Session = Depends(get_db)):
    b = brief_service.build(db, shop, send=False)
    return {"text": b.text, "day": b.day.isoformat(), "stats": b.stats}
