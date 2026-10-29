"""Sample data for a realistic demo kirana store: 90 days of Paytm sales, udhaar ledger, stock, suppliers, lapsed regulars.

All dates are relative to today so the demo works any day. Phone numbers are
deliberately invalid (+9100000000NN) so nothing real can ever be contacted; in
real (non-mock) mode use the admin 'test redirect number' to route messages and
calls to your own sandbox-joined phone.
"""
import random
from datetime import date, datetime, timedelta

from sqlalchemy import insert, select
from sqlalchemy.orm import Session

from . import clock
from .auth import hash_password, verify_password
from .config import get_settings
from .models import (Action, AuditLog, Approval, Brief, CallSession, Customer, DailySale, Message, OutboundMessage,
                     PayLink, Plan, Product, Shop, Supplier, UdhaarEntry, User)

SUPPLIERS = [
    ("Shree Foods Distributors", "ghee, dry fruits, oil, besan"),
    ("Gupta Wholesale", "atta, rice, dal, sugar"),
    ("Jain Traders", "namkeen, biscuits, sweets"),
    ("Verma Beverages", "cold drinks, tea, coffee"),
    ("Agarwal Household", "soap, detergent, toiletries"),
]

# name, category, unit, supplier idx, stock, reorder, cost, price, avg/day, last-festival units (10-day window)
# The first 12 are festive-season items (sold ~3x normal last festival, now low) from the main supplier.
PRODUCTS = [
    ("Desi Ghee 1kg", "Ghee & Oil", "tin", 0, 14, 20, 560, 640, 4, 130),
    ("Desi Ghee 500g", "Ghee & Oil", "pack", 0, 12, 18, 290, 330, 3, 90),
    ("Almonds (Badam) 500g", "Dry Fruits", "pack", 0, 6, 12, 420, 480, 2, 70),
    ("Cashew (Kaju) 500g", "Dry Fruits", "pack", 0, 5, 12, 480, 550, 2, 66),
    ("Raisins (Kishmish) 500g", "Dry Fruits", "pack", 0, 8, 12, 170, 200, 2, 52),
    ("Walnuts (Akhrot) 500g", "Dry Fruits", "pack", 0, 4, 8, 390, 450, 1, 34),
    ("Pistachio 250g", "Dry Fruits", "pack", 0, 3, 8, 330, 390, 1, 30),
    ("Dates (Khajoor) 500g", "Dry Fruits", "pack", 0, 9, 12, 140, 170, 2, 44),
    ("Besan 1kg", "Atta & Flour", "pack", 0, 10, 16, 78, 92, 3, 60),
    ("Mustard Oil 1L", "Ghee & Oil", "bottle", 0, 12, 18, 150, 175, 4, 92),
    ("Refined Oil 5L", "Ghee & Oil", "can", 0, 6, 10, 640, 720, 2, 40),
    ("Sugar 5kg", "Staples", "pack", 0, 16, 24, 205, 235, 4, 92),
    ("Aashirvaad Atta 10kg", "Atta & Flour", "bag", 1, 30, 15, 395, 440, 6, 22),
    ("Basmati Rice 5kg", "Staples", "bag", 1, 22, 12, 520, 590, 3, 14),
    ("Toor Dal 1kg", "Staples", "pack", 1, 35, 15, 135, 155, 6, 18),
    ("Moong Dal 1kg", "Staples", "pack", 1, 28, 12, 120, 138, 4, 12),
    ("Chana Dal 1kg", "Staples", "pack", 1, 26, 12, 98, 114, 4, 12),
    ("Rajma 1kg", "Staples", "pack", 1, 20, 10, 130, 150, 2, 9),
    ("Poha 500g", "Staples", "pack", 1, 40, 15, 38, 46, 6, 14),
    ("Salt 1kg", "Staples", "pack", 1, 60, 25, 18, 24, 9, 10),
    ("Bhujia Sev 400g", "Namkeen", "pack", 2, 34, 15, 72, 90, 7, 40),
    ("Parle-G Biscuit", "Biscuits", "pack", 2, 80, 30, 8, 10, 25, 30),
    ("Good Day Cookies", "Biscuits", "pack", 2, 45, 20, 28, 35, 10, 18),
    ("Haldiram Soan Papdi 500g", "Sweets", "box", 2, 18, 12, 120, 150, 3, 20),
    ("Kaju Katli 250g", "Sweets", "box", 2, 20, 10, 210, 260, 2, 16),
    ("Maggi 70g", "Instant Food", "pack", 2, 90, 40, 12, 14, 22, 22),
    ("Tata Tea Gold 500g", "Beverages", "pack", 3, 25, 12, 245, 275, 5, 18),
    ("Nescafe Classic 100g", "Beverages", "jar", 3, 16, 8, 295, 340, 2, 8),
    ("Coca-Cola 2L", "Beverages", "bottle", 3, 24, 12, 72, 90, 6, 12),
    ("Frooti 1L", "Beverages", "pack", 3, 20, 10, 55, 70, 4, 10),
    ("Surf Excel 1kg", "Household", "pack", 4, 18, 8, 190, 220, 3, 9),
    ("Vim Dishwash Bar", "Household", "pack", 4, 40, 15, 9, 12, 8, 12),
    ("Lifebuoy Soap", "Personal Care", "pack", 4, 50, 20, 24, 30, 8, 10),
    ("Colgate 200g", "Personal Care", "pack", 4, 32, 12, 96, 112, 5, 10),
    ("Dettol Handwash 200ml", "Personal Care", "bottle", 4, 22, 10, 85, 99, 3, 8),
    ("Pooja Agarbatti", "Pooja", "pack", 4, 60, 25, 28, 38, 7, 55),
    ("Diyas (set of 12)", "Pooja", "set", 4, 40, 30, 36, 55, 3, 70),
    ("Camphor (Kapoor) 50g", "Pooja", "pack", 4, 30, 20, 42, 60, 2, 30),
    ("Tomato Ketchup 500g", "Instant Food", "bottle", 2, 25, 10, 85, 105, 3, 6),
    ("Amul Butter 500g", "Dairy", "pack", 3, 20, 10, 255, 285, 3, 12),
]

FIRST = ["Amit", "Sunita", "Rakesh", "Meena", "Vijay", "Pooja", "Suresh", "Anita", "Manoj", "Kavita", "Deepak", "Neha",
         "Rohit", "Seema", "Sanjay", "Rekha", "Ajay", "Geeta", "Pawan", "Mamta", "Naveen", "Shanti", "Ramesh", "Lata",
         "Dinesh", "Usha", "Mohan", "Savita", "Ashok", "Radha", "Vinod", "Kamla", "Harish", "Poonam", "Yogesh", "Sarita",
         "Tarun", "Babita", "Lalit", "Nisha", "Kishan", "Rani", "Gopal", "Asha", "Bhupesh", "Madhu", "Sandeep", "Jyoti"]
LAST = ["Gupta", "Sharma", "Verma", "Singh", "Kapoor", "Malhotra", "Arora", "Khanna", "Bhatia", "Chopra", "Saini", "Yadav",
        "Mehra", "Sethi", "Tandon", "Joshi", "Bansal", "Goel", "Mittal", "Jain"]


def _phone(i: int) -> str:
    return f"+9100000000{i:02d}" if i < 100 else f"+910000000{i:03d}"


def _names(rng: random.Random, n: int) -> list[str]:
    names, seen = [], set()
    while len(names) < n:
        nm = f"{rng.choice(FIRST)} {rng.choice(LAST)}"
        if nm not in seen:
            seen.add(nm)
            names.append(nm)
    return names


def wipe_shop_data(db: Session, shop_id: int, commit: bool = True) -> None:
    act_ids = [a.id for a in db.query(Action.id).filter(Action.shop_id == shop_id)]
    if act_ids:
        db.query(CallSession).filter(CallSession.action_id.in_(act_ids)).delete(synchronize_session=False)
    db.query(CallSession).filter(CallSession.shop_id == shop_id).delete(synchronize_session=False)
    for model in (OutboundMessage, Message, Action, Approval, Plan, PayLink, Brief, UdhaarEntry, DailySale, Product,
                  Customer, Supplier, AuditLog):
        db.query(model).filter(model.shop_id == shop_id).delete(synchronize_session=False)
    if commit:
        db.commit()


def _bulk(db: Session, model, rows: list[dict], chunk: int = 40) -> None:
    """Multi-row INSERTs: a handful of round-trips instead of one per row (matters a lot over Turso)."""
    for i in range(0, len(rows), chunk):
        db.execute(insert(model).values(rows[i:i + chunk]))


def seed_demo(db: Session, shop: Shop) -> dict:
    """Wipe + reseed one shop atomically (single transaction: a failure leaves the old data intact)."""
    rng = random.Random(42)
    today = clock.today()
    now = datetime.utcnow()
    try:
        wipe_shop_data(db, shop.id, commit=False)

        shop.name = "Kumar General Store"
        shop.locality = "New Delhi"
        shop.upi_vpa = shop.upi_vpa or "kumarstore@paytm"
        shop.daily_spend_cap = 75000
        shop.per_order_cap = 50000
        shop.onboarded = True
        shop.demo_loaded = True

        _bulk(db, Supplier, [dict(shop_id=shop.id, name=n, phone=_phone(i + 1), categories=c, notes="") for i, (n, c) in enumerate(SUPPLIERS)])
        sup_id = dict(db.execute(select(Supplier.name, Supplier.id).where(Supplier.shop_id == shop.id)).all())

        _bulk(db, Product, [
            dict(shop_id=shop.id, supplier_id=sup_id[SUPPLIERS[p[3]][0]], name=p[0], category=p[1], unit=p[2], stock=p[4], reorder_level=p[5],
                 unit_cost=p[6], price=p[7], avg_daily_units=p[8], last_festival_units=p[9], incoming_qty=0, incoming_eta="")
            for p in PRODUCTS])

        # --- 90 days of Paytm payments (~Rs 14,000/day, ~340 payments/day), festive ramp in the last 12 days
        sales = []
        for back in range(89, -1, -1):
            d = today - timedelta(days=back)
            base = 14000 * (1.18 if d.weekday() >= 5 else 1.0) * rng.uniform(0.9, 1.1)
            if back <= 12:
                base *= 1 + (12 - back) * 0.018
            amount = round(base, 2)
            if back == 0:  # today is partial, shop opens 7am
                amount = round(amount * 0.62, 2)
            sales.append(dict(shop_id=shop.id, day=d, amount=amount, payments=int(amount / 41.2)))
        _bulk(db, DailySale, sales)

        # --- 41 udhaar customers owing exactly Rs 38,000, 60 lapsed regulars, 25 active regulars
        names = _names(rng, 41 + 60 + 25)
        udhaar_names, lapsed_names, active_names = names[:41], names[41:101], names[101:]
        weights = [rng.uniform(0.3, 2.2) for _ in udhaar_names]
        scale = 38000 / sum(weights)
        balances = [max(100, int(round(w * scale / 10.0)) * 10) for w in weights]
        balances[-1] += 38000 - sum(balances)

        cust_rows = []
        for i, nm in enumerate(udhaar_names):
            cust_rows.append(dict(shop_id=shop.id, name=nm, phone=_phone(100 + i), last_visit=today - timedelta(days=rng.randint(0, 20)),
                                  visits=rng.randint(15, 80), lifetime_spend=rng.randint(8000, 40000)))
        for i, nm in enumerate(lapsed_names):
            cust_rows.append(dict(shop_id=shop.id, name=nm, phone=_phone(200 + i), last_visit=today - timedelta(days=rng.randint(35, 140)),
                                  visits=rng.randint(12, 60), lifetime_spend=rng.randint(6000, 30000)))
        for i, nm in enumerate(active_names):
            cust_rows.append(dict(shop_id=shop.id, name=nm, phone=_phone(300 + i), last_visit=today - timedelta(days=rng.randint(0, 9)),
                                  visits=rng.randint(10, 60), lifetime_spend=rng.randint(5000, 25000)))
        for r in cust_rows:
            r["last_reminded_at"] = None
        _bulk(db, Customer, cust_rows)
        cust_id = dict(db.execute(select(Customer.name, Customer.id).where(Customer.shop_id == shop.id)).all())

        notes = ["atta, dal", "ghee 1kg", "ration", "chai patti, sugar", "tel, masale", "bachon ke biscuit", "monthly saaman", "dry fruits"]
        entries = []
        for nm, bal in zip(udhaar_names, balances):
            parts = rng.choice([1, 2, 2, 3])
            cuts = sorted(rng.sample(range(1, 10), parts - 1)) if parts > 1 else []
            pieces, prev = [], 0
            for c in cuts + [10]:
                pieces.append(int(round(bal * (c - prev) / 10.0 / 10.0)) * 10)
                prev = c
            pieces[-1] += bal - sum(pieces)
            for amt in pieces:
                if amt > 0:
                    entries.append(dict(shop_id=shop.id, customer_id=cust_id[nm], amount=amt, kind="credit", note=rng.choice(notes), source="manual",
                                        simulated=False, created_at=datetime.combine(today - timedelta(days=rng.randint(3, 55)), datetime.min.time())))
        _bulk(db, UdhaarEntry, entries)

        db.add(AuditLog(shop_id=shop.id, actor="system", event="demo_data_loaded", detail={"udhaar_total": 38000, "customers": len(cust_rows)}))
        db.commit()
    except Exception:
        db.rollback()
        raise
    return {"customers": len(cust_rows), "products": len(PRODUCTS), "udhaar_total": 38000}


def ensure_user(db: Session, email: str, password: str, name: str, role: str) -> User:
    user = db.query(User).filter(User.email == email).first()
    if user:
        return user
    user = User(email=email, name=name, password_hash=hash_password(password), role=role)
    db.add(user)
    db.flush()
    db.add(Shop(owner_id=user.id, name=f"{name} Store" if role != "merchant" else "Kumar General Store"))
    db.commit()
    return user


def bootstrap(db: Session) -> None:
    s = get_settings()
    admin = ensure_user(db, s.admin_email.lower(), s.admin_password, "Admin", "admin")
    # ADMIN_PASSWORD is the source of truth: rotating it in the environment rotates the stored hash on next start.
    if admin.role != "admin" or not verify_password(s.admin_password, admin.password_hash):
        admin.role = "admin"
        admin.password_hash = hash_password(s.admin_password)
        db.commit()
    legacy = db.query(User).filter(User.email == "raj@munshi.demo").first()
    if legacy and not db.query(User).filter(User.email == s.demo_email.lower()).first():
        legacy.email, legacy.name = s.demo_email.lower(), "Ramesh Kumar"  # migrate the pre-rename demo account in place
        db.commit()
    ensure_user(db, s.demo_email.lower(), s.demo_password, "Ramesh Kumar", "merchant")
