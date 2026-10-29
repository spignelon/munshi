from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from ..auth import current_shop
from ..db import get_db
from ..models import Customer, Product, Shop, Supplier, UdhaarEntry
from ..serializers import customer_out, iso, message_out, product_out, supplier_out
from ..services import business, executor, messaging, ocr, payments
from .core import norm_phone

router = APIRouter(prefix="/api")

MAX_IMAGE = 4_000_000


def _balances(db: Session, shop: Shop) -> dict[int, float]:
    signed = func.sum(case((UdhaarEntry.kind == "credit", UdhaarEntry.amount), else_=-UdhaarEntry.amount))
    return {cid: float(b or 0) for cid, b in db.query(UdhaarEntry.customer_id, signed).filter(UdhaarEntry.shop_id == shop.id).group_by(UdhaarEntry.customer_id)}


def _own_customer(db: Session, shop: Shop, cid: int) -> Customer:
    c = db.get(Customer, cid)
    if not c or c.shop_id != shop.id:
        raise HTTPException(404, "Customer nahi mila.")
    return c


# ---------------------------------------------------------------- udhaar ledger
@router.get("/udhaar")
def udhaar_list(shop: Shop = Depends(current_shop), db: Session = Depends(get_db)):
    rows = business.udhaar_balances(db, shop)
    return {"total": sum(b for _, b in rows), "customers": [customer_out(c, b) for c, b in rows]}


@router.get("/udhaar/{customer_id}/entries")
def udhaar_entries(customer_id: int, shop: Shop = Depends(current_shop), db: Session = Depends(get_db)):
    c = _own_customer(db, shop, customer_id)
    rows = db.query(UdhaarEntry).filter(UdhaarEntry.customer_id == c.id).order_by(UdhaarEntry.id.desc()).limit(100).all()
    return [{"id": e.id, "amount": e.amount, "kind": e.kind, "note": e.note, "source": e.source, "simulated": e.simulated,
             "created_at": iso(e.created_at)} for e in rows]


class EntryIn(BaseModel):
    customer_id: int | None = None
    name: str = ""
    phone: str = ""
    amount: float = Field(gt=0, le=10_000_000)
    kind: str = Field(default="credit", pattern="^(credit|payment)$")
    note: str = Field(default="", max_length=290)


@router.post("/udhaar/entries")
def add_entry(body: EntryIn, shop: Shop = Depends(current_shop), db: Session = Depends(get_db)):
    if body.customer_id:
        c = _own_customer(db, shop, body.customer_id)
    else:
        if not body.name.strip():
            raise HTTPException(422, "Customer ka naam daaliye.")
        c = Customer(shop_id=shop.id, name=body.name.strip()[:150], phone=norm_phone(body.phone), visits=1)
        db.add(c)
        db.flush()
    db.add(UdhaarEntry(shop_id=shop.id, customer_id=c.id, amount=body.amount, kind=body.kind, note=body.note, source="manual"))
    db.commit()
    return customer_out(c, _balances(db, shop).get(c.id, 0))


@router.post("/udhaar/{customer_id}/remind")
def remind_one(customer_id: int, shop: Shop = Depends(current_shop), db: Session = Depends(get_db)):
    """Raj's own tap is the approval for a single reminder; it's logged like any other action."""
    c = _own_customer(db, shop, customer_id)
    bal = _balances(db, shop).get(c.id, 0)
    if bal <= 0:
        raise HTTPException(400, "Is customer ka udhaar baaki nahi hai.")
    if not c.phone:
        raise HTTPException(400, "Is customer ka phone number nahi hai.")
    link = payments.make_link(db, shop, c, bal)
    body = f"Namaste {c.name.split()[0]} ji 🙏 {shop.name} se. Aapka ₹{int(bal):,} baaki hai. UPI/Paytm se yahan chuka sakte hain: {link}\nDhanyavaad!"
    m = messaging.send_whatsapp(db, shop, to=c.phone, body=body, recipient_name=c.name, customer_id=c.id)
    if m.status == "sent":
        c.last_reminded_at = datetime.utcnow()
    executor.audit(db, shop, "manual_reminder", ref=f"customer:{c.id}", actor="raj", status=m.status)
    db.commit()
    if m.status != "sent":
        raise HTTPException(502, m.error or "Message send nahi hua.")
    return message_out(m)


@router.post("/udhaar/scan")
async def scan_ledger(image: UploadFile = File(...), shop: Shop = Depends(current_shop), db: Session = Depends(get_db)):
    data = await image.read()
    if len(data) > MAX_IMAGE:
        raise HTTPException(413, "Photo bahut badi hai (max 4MB).")
    mime = image.content_type or "image/jpeg"
    if not mime.startswith("image/"):
        raise HTTPException(415, "Sirf photo upload karein.")
    entries = ocr.scan(db, shop, data, mime)
    return {"entries": entries}


class ImportIn(BaseModel):
    entries: list[EntryIn]


@router.post("/udhaar/import")
def import_entries(body: ImportIn, shop: Shop = Depends(current_shop), db: Session = Depends(get_db)):
    n = executor.import_entries(db, shop, [e.model_dump() for e in body.entries], source="ocr")
    executor.audit(db, shop, "ledger_imported", actor="raj", count=n)
    db.commit()
    return {"imported": n}


# ---------------------------------------------------------------- customers
@router.get("/customers")
def customers(lapsed: bool = False, q: str = "", shop: Shop = Depends(current_shop), db: Session = Depends(get_db)):
    bal = _balances(db, shop)
    if lapsed:
        rows = business.lapsed_customers(db, shop, limit=500)
    else:
        query = db.query(Customer).filter(Customer.shop_id == shop.id)
        if q:
            query = query.filter(Customer.name.ilike(f"%{q}%"))
        rows = query.order_by(Customer.name).limit(500).all()
    return [customer_out(c, bal.get(c.id, 0)) for c in rows]


class CustomerIn(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    phone: str = ""


@router.post("/customers")
def create_customer(body: CustomerIn, shop: Shop = Depends(current_shop), db: Session = Depends(get_db)):
    c = Customer(shop_id=shop.id, name=body.name.strip(), phone=norm_phone(body.phone), visits=0)
    db.add(c)
    db.commit()
    return customer_out(c)


# ---------------------------------------------------------------- inventory
@router.get("/products")
def products(shop: Shop = Depends(current_shop), db: Session = Depends(get_db)):
    rows = db.query(Product).filter(Product.shop_id == shop.id).order_by(Product.category, Product.name).all()
    return [product_out(p, business.is_festive(p)) for p in rows]


class ProductIn(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    category: str = ""
    unit: str = "pcs"
    stock: float = Field(default=0, ge=0)
    reorder_level: float = Field(default=0, ge=0)
    unit_cost: float = Field(default=0, ge=0)
    price: float = Field(default=0, ge=0)
    supplier_id: int | None = None


def _own_supplier(db: Session, shop: Shop, sid: int | None) -> int | None:
    if sid is None:
        return None
    s = db.get(Supplier, sid)
    if not s or s.shop_id != shop.id:
        raise HTTPException(422, "Supplier galat hai.")
    return sid


@router.post("/products")
def create_product(body: ProductIn, shop: Shop = Depends(current_shop), db: Session = Depends(get_db)):
    data = body.model_dump()
    data["supplier_id"] = _own_supplier(db, shop, data["supplier_id"])
    p = Product(shop_id=shop.id, **data)
    db.add(p)
    db.commit()
    return product_out(p)


@router.put("/products/{pid}")
def update_product(pid: int, body: ProductIn, shop: Shop = Depends(current_shop), db: Session = Depends(get_db)):
    p = db.get(Product, pid)
    if not p or p.shop_id != shop.id:
        raise HTTPException(404, "Product nahi mila.")
    data = body.model_dump()
    data["supplier_id"] = _own_supplier(db, shop, data["supplier_id"])
    for k, v in data.items():
        setattr(p, k, v)
    db.commit()
    return product_out(p, business.is_festive(p))


@router.delete("/products/{pid}")
def delete_product(pid: int, shop: Shop = Depends(current_shop), db: Session = Depends(get_db)):
    p = db.get(Product, pid)
    if not p or p.shop_id != shop.id:
        raise HTTPException(404, "Product nahi mila.")
    db.delete(p)
    db.commit()
    return {"ok": True}


@router.get("/inventory/forecast")
def forecast(shop: Shop = Depends(current_shop), db: Session = Depends(get_db)):
    out = []
    for s in db.query(Supplier).filter(Supplier.shop_id == shop.id).all():
        lines = business.festive_order_lines(db, shop, s.id)
        if lines:
            out.append({"supplier": supplier_out(s), "lines": lines, "total": business.lines_total(lines)})
    return {"festival": business.festival(), "groups": out}


# ---------------------------------------------------------------- suppliers
class SupplierIn(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    phone: str = ""
    categories: str = ""
    notes: str = ""


@router.get("/suppliers")
def suppliers(shop: Shop = Depends(current_shop), db: Session = Depends(get_db)):
    return [supplier_out(s) for s in db.query(Supplier).filter(Supplier.shop_id == shop.id).order_by(Supplier.name).all()]


@router.post("/suppliers")
def create_supplier(body: SupplierIn, shop: Shop = Depends(current_shop), db: Session = Depends(get_db)):
    s = Supplier(shop_id=shop.id, name=body.name.strip(), phone=norm_phone(body.phone), categories=body.categories, notes=body.notes)
    db.add(s)
    db.commit()
    return supplier_out(s)


@router.put("/suppliers/{sid}")
def update_supplier(sid: int, body: SupplierIn, shop: Shop = Depends(current_shop), db: Session = Depends(get_db)):
    s = db.get(Supplier, sid)
    if not s or s.shop_id != shop.id:
        raise HTTPException(404, "Supplier nahi mila.")
    s.name, s.phone, s.categories, s.notes = body.name.strip(), norm_phone(body.phone), body.categories, body.notes
    db.commit()
    return supplier_out(s)
