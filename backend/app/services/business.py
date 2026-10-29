"""Deterministic business calculations. The LLM never does arithmetic: it picks
actions, and amounts / quantities / recipient lists come from here."""
import math
from datetime import date, datetime, timedelta

from sqlalchemy import case, func
from sqlalchemy.orm import Session

from .. import clock
from ..config import get_settings
from ..models import Action, Customer, DailySale, Product, Shop, Supplier, UdhaarEntry

FESTIVE_RATIO = 2.0      # sold >= 2x normal demand in last year's festival window => festive item
FESTIVE_GROWTH = 1.1     # expected growth vs last year
FESTIVE_COVER = 0.26     # fraction of expected festival demand we stock up on in this order
FESTIVE_WINDOW_DAYS = 10
LAPSED_DAYS = 30


def inr(x: float) -> str:
    n = int(round(x))
    s = str(abs(n))
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        s = ",".join(parts + [tail])
    return ("-" if n < 0 else "") + "₹" + s


def festival() -> dict:
    s = get_settings()
    try:
        d = date.fromisoformat(s.festival_date)
    except ValueError:
        d = clock.today() + timedelta(days=14)
    days = (d - clock.today()).days
    # keep the demo evergreen: after the festival passes, point at the next Diwali-sized window
    if days < -3:
        d = d.replace(year=d.year + 1)
        days = (d - clock.today()).days
    return {"name": s.festival_name, "date": d.isoformat(), "days_away": days}


def sales_summary(db: Session, shop: Shop) -> dict:
    today = clock.today()
    rows = db.query(DailySale).filter(DailySale.shop_id == shop.id, DailySale.day >= today - timedelta(days=30)).all()
    by_day = {r.day: r for r in rows}
    t = by_day.get(today)
    y = by_day.get(today - timedelta(days=1))
    last7 = [by_day[today - timedelta(days=i)].amount for i in range(1, 8) if (today - timedelta(days=i)) in by_day]
    return {
        "today": t.amount if t else 0.0,
        "today_payments": t.payments if t else 0,
        "yesterday": y.amount if y else 0.0,
        "avg_7d": sum(last7) / len(last7) if last7 else 0.0,
        "total_30d": sum(r.amount for r in rows),
        "series": [{"day": r.day.isoformat(), "amount": round(r.amount)} for r in sorted(rows, key=lambda r: r.day)],
    }


def udhaar_balances(db: Session, shop: Shop) -> list[tuple[Customer, float]]:
    signed = func.sum(case((UdhaarEntry.kind == "credit", UdhaarEntry.amount), else_=-UdhaarEntry.amount))
    rows = (db.query(Customer, signed.label("bal"))
            .join(UdhaarEntry, UdhaarEntry.customer_id == Customer.id)
            .filter(Customer.shop_id == shop.id)
            .group_by(Customer.id).having(signed > 0.5).order_by(signed.desc()).all())
    return [(c, float(b)) for c, b in rows]


def udhaar_total(db: Session, shop: Shop) -> float:
    signed = func.sum(case((UdhaarEntry.kind == "credit", UdhaarEntry.amount), else_=-UdhaarEntry.amount))
    inner = (db.query(signed.label("bal")).filter(UdhaarEntry.shop_id == shop.id)
             .group_by(UdhaarEntry.customer_id).having(signed > 0.5).subquery())
    return float(db.query(func.coalesce(func.sum(inner.c.bal), 0)).scalar() or 0)


def festive_need(p: Product) -> float:
    return p.last_festival_units * FESTIVE_GROWTH


def is_festive(p: Product) -> bool:
    base = p.avg_daily_units * FESTIVE_WINDOW_DAYS
    return base > 0 and p.last_festival_units / base >= FESTIVE_RATIO


def festive_order_lines(db: Session, shop: Shop, supplier_id: int | None = None) -> list[dict]:
    """Items that sold >=2x last festival and are now short of the cover target."""
    q = db.query(Product).filter(Product.shop_id == shop.id)
    if supplier_id:
        q = q.filter(Product.supplier_id == supplier_id)
    lines = []
    for p in q.all():
        if not is_festive(p):
            continue
        target = math.ceil(festive_need(p) * FESTIVE_COVER)
        have = p.stock + p.incoming_qty
        qty = int(target - have)
        if qty > 0 and have < max(p.reorder_level, target):
            lines.append({"product_id": p.id, "name": p.name, "unit": p.unit, "qty": qty, "unit_cost": p.unit_cost,
                          "stock": p.stock, "last_festival_units": p.last_festival_units,
                          "multiple": round(p.last_festival_units / (p.avg_daily_units * FESTIVE_WINDOW_DAYS), 1)})
    lines.sort(key=lambda l: l["qty"] * l["unit_cost"], reverse=True)
    return lines


def reorder_lines(db: Session, shop: Shop, supplier_id: int | None = None) -> list[dict]:
    q = db.query(Product).filter(Product.shop_id == shop.id, Product.stock < Product.reorder_level)
    if supplier_id:
        q = q.filter(Product.supplier_id == supplier_id)
    return [{"product_id": p.id, "name": p.name, "unit": p.unit, "qty": int(math.ceil(p.reorder_level * 2 - p.stock - p.incoming_qty)),
             "unit_cost": p.unit_cost, "stock": p.stock} for p in q.all() if p.reorder_level * 2 - p.stock - p.incoming_qty > 0]


def lines_total(lines: list[dict]) -> float:
    return float(sum(l["qty"] * l["unit_cost"] for l in lines))


def lapsed_customers(db: Session, shop: Shop, limit: int = 200) -> list[Customer]:
    cutoff = clock.today() - timedelta(days=LAPSED_DAYS)
    return (db.query(Customer).filter(Customer.shop_id == shop.id, Customer.last_visit != None, Customer.last_visit < cutoff)  # noqa: E711
            .order_by(Customer.lifetime_spend.desc()).limit(limit).all())


def loan_offer(db: Session, shop: Shop) -> dict:
    total = sales_summary(db, shop)["total_30d"]
    amount = max(10000, min(200000, int(total * 0.11 // 5000 * 5000)))
    return {"amount": amount, "tenure_months": 6, "basis_30d_sales": round(total),
            "note": "Simulated offer sized at ~11% of your last 30 days of Paytm sales."}


def spent_today(db: Session, shop: Shop) -> float:
    start = clock.day_start_utc()
    v = (db.query(func.coalesce(func.sum(Action.amount), 0))
         .filter(Action.shop_id == shop.id, Action.type == "supplier_order", Action.created_at >= start,
                 Action.status.in_(["approved", "executing", "done"])).scalar())
    return float(v or 0)


def find_supplier(db: Session, shop: Shop, name_hint: str | None) -> Supplier | None:
    sups = db.query(Supplier).filter(Supplier.shop_id == shop.id).all()
    if not sups:
        return None
    hint = (name_hint or "").lower()
    for s in sups:
        if hint and (hint in s.name.lower() or s.name.lower().split()[0] in hint):
            return s
    # default: supplier covering the most festive demand
    best, best_v = sups[0], -1.0
    for s in sups:
        v = lines_total(festive_order_lines(db, shop, s.id))
        if v > best_v:
            best, best_v = s, v
    return best


def snapshot(db: Session, shop: Shop) -> str:
    """Compact (~250 token) context for the planner."""
    f = festival()
    sm = sales_summary(db, shop)
    bal = udhaar_balances(db, shop)
    sup = find_supplier(db, shop, None)
    lines = festive_order_lines(db, shop, sup.id) if sup else []
    lapsed = lapsed_customers(db, shop)
    loan = loan_offer(db, shop)
    top = ", ".join(f"{c.name.split()[0]} {inr(b)}" for c, b in bal[:3]) or "none"
    low = ", ".join(f"{l['name']}({int(l['stock'])} left, last yr {int(l['last_festival_units'])})" for l in lines[:4]) or "none"
    sups = "; ".join(f"{s.name} [{s.categories}]" for s in db.query(Supplier).filter(Supplier.shop_id == shop.id).all()) or "none"
    return (
        f"Shop: {shop.name}, {shop.locality}. Today {clock.today().isoformat()}. {f['name']} in {f['days_away']} days.\n"
        f"Paytm sales: today so far {inr(sm['today'])}, yesterday {inr(sm['yesterday'])}, 7-day avg {inr(sm['avg_7d'])}.\n"
        f"Udhaar: {len(bal)} customers owe {inr(sum(b for _, b in bal))}; top: {top}.\n"
        f"Festive low stock: {len(lines)} items need restocking (~{inr(lines_total(lines))} from {sup.name if sup else 'n/a'}); e.g. {low}.\n"
        f"Lapsed regulars (>{LAPSED_DAYS}d): {len(lapsed)}.\n"
        f"Suppliers: {sups}.\n"
        f"Limits: per order {inr(shop.per_order_cap)}, daily {inr(shop.daily_spend_cap)}, spent today {inr(spent_today(db, shop))}.\n"
        f"Loan pre-offer: {inr(loan['amount'])}."
    )
