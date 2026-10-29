from datetime import date, datetime, timezone

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120), default="")
    phone: Mapped[str] = mapped_column(String(30), default="")
    password_hash: Mapped[str] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(20), default="merchant")  # merchant | admin
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    shop: Mapped["Shop"] = relationship(back_populates="owner", uselist=False)


class Shop(Base):
    __tablename__ = "shops"
    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True)
    name: Mapped[str] = mapped_column(String(160), default="My Kirana")
    locality: Mapped[str] = mapped_column(String(160), default="")
    upi_vpa: Mapped[str] = mapped_column(String(120), default="")
    whatsapp_number: Mapped[str] = mapped_column(String(30), default="")  # owner's number, E.164
    language: Mapped[str] = mapped_column(String(10), default="hi")
    daily_spend_cap: Mapped[float] = mapped_column(Float, default=50000)
    per_order_cap: Mapped[float] = mapped_column(Float, default=25000)
    onboarded: Mapped[bool] = mapped_column(Boolean, default=False)
    demo_loaded: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    owner: Mapped[User] = relationship(back_populates="shop")


class Supplier(Base):
    __tablename__ = "suppliers"
    id: Mapped[int] = mapped_column(primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), index=True)
    name: Mapped[str] = mapped_column(String(160))
    phone: Mapped[str] = mapped_column(String(30), default="")
    categories: Mapped[str] = mapped_column(String(300), default="")
    notes: Mapped[str] = mapped_column(String(300), default="")


class Product(Base):
    __tablename__ = "products"
    id: Mapped[int] = mapped_column(primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), index=True)
    supplier_id: Mapped[int | None] = mapped_column(ForeignKey("suppliers.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(160))
    category: Mapped[str] = mapped_column(String(80), default="")
    unit: Mapped[str] = mapped_column(String(20), default="pcs")
    stock: Mapped[float] = mapped_column(Float, default=0)
    reorder_level: Mapped[float] = mapped_column(Float, default=0)
    unit_cost: Mapped[float] = mapped_column(Float, default=0)
    price: Mapped[float] = mapped_column(Float, default=0)
    avg_daily_units: Mapped[float] = mapped_column(Float, default=0)
    last_festival_units: Mapped[float] = mapped_column(Float, default=0)  # units sold in last year's festival window
    incoming_qty: Mapped[float] = mapped_column(Float, default=0)
    incoming_eta: Mapped[str] = mapped_column(String(60), default="")


class DailySale(Base):
    """Paytm payment totals per day (aggregated)."""
    __tablename__ = "daily_sales"
    __table_args__ = (UniqueConstraint("shop_id", "day"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), index=True)
    day: Mapped[date] = mapped_column(Date, index=True)
    amount: Mapped[float] = mapped_column(Float, default=0)
    payments: Mapped[int] = mapped_column(Integer, default=0)


class Customer(Base):
    __tablename__ = "customers"
    id: Mapped[int] = mapped_column(primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), index=True)
    name: Mapped[str] = mapped_column(String(160))
    phone: Mapped[str] = mapped_column(String(30), default="")
    last_visit: Mapped[date | None] = mapped_column(Date, nullable=True)
    visits: Mapped[int] = mapped_column(Integer, default=0)
    lifetime_spend: Mapped[float] = mapped_column(Float, default=0)
    last_reminded_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class UdhaarEntry(Base):
    __tablename__ = "udhaar_entries"
    id: Mapped[int] = mapped_column(primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"), index=True)
    amount: Mapped[float] = mapped_column(Float)
    kind: Mapped[str] = mapped_column(String(10))  # credit (owes more) | payment
    note: Mapped[str] = mapped_column(String(300), default="")
    source: Mapped[str] = mapped_column(String(20), default="manual")  # manual | ocr | voice | paytm | mock-payment
    simulated: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Message(Base):
    """Conversation turns between Raj and Munshi across channels."""
    __tablename__ = "messages"
    id: Mapped[int] = mapped_column(primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), index=True)
    channel: Mapped[str] = mapped_column(String(20), default="web")  # web | whatsapp | phone
    role: Mapped[str] = mapped_column(String(10))  # user | munshi
    text: Mapped[str] = mapped_column(Text, default="")
    plan_id: Mapped[int | None] = mapped_column(ForeignKey("plans.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Plan(Base):
    __tablename__ = "plans"
    id: Mapped[int] = mapped_column(primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), index=True)
    utterance: Mapped[str] = mapped_column(Text, default="")
    channel: Mapped[str] = mapped_column(String(20), default="web")
    summary: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="proposed")  # proposed|approved|rejected|executed|partial|failed|blocked
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    actions: Mapped[list["Action"]] = relationship(back_populates="plan", order_by="Action.id", cascade="all, delete-orphan")
    approvals: Mapped[list["Approval"]] = relationship(back_populates="plan", order_by="Approval.id", cascade="all, delete-orphan")


class Action(Base):
    __tablename__ = "actions"
    id: Mapped[int] = mapped_column(primary_key=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("plans.id"), index=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), index=True)
    type: Mapped[str] = mapped_column(String(30))  # supplier_order|udhaar_reminders|winback_offer|loan_offer|stock_report|ledger_import
    title: Mapped[str] = mapped_column(String(300), default="")
    detail: Mapped[str] = mapped_column(Text, default="")
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    amount: Mapped[float] = mapped_column(Float, default=0)  # rupees that would move (spend) — drives the caps
    status: Mapped[str] = mapped_column(String(20), default="proposed")  # proposed|approved|executing|done|failed|rejected|blocked
    blocked_reason: Mapped[str] = mapped_column(String(300), default="")
    result: Mapped[dict] = mapped_column(JSON, default=dict)
    simulated: Mapped[bool] = mapped_column(Boolean, default=False)
    approval_id: Mapped[int | None] = mapped_column(ForeignKey("approvals.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    plan: Mapped[Plan] = relationship(back_populates="actions")


class Approval(Base):
    """The audit anchor: the moment Raj said 'haan'."""
    __tablename__ = "approvals"
    id: Mapped[int] = mapped_column(primary_key=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("plans.id"), index=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), index=True)
    decision: Mapped[str] = mapped_column(String(10))  # approved | rejected
    channel: Mapped[str] = mapped_column(String(20), default="web")
    utterance: Mapped[str] = mapped_column(String(300), default="")
    action_ids: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    plan: Mapped[Plan] = relationship(back_populates="approvals")


class CallSession(Base):
    __tablename__ = "call_sessions"
    id: Mapped[int] = mapped_column(primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), index=True)
    action_id: Mapped[int | None] = mapped_column(ForeignKey("actions.id"), nullable=True)
    direction: Mapped[str] = mapped_column(String(10), default="outbound")
    counterpart: Mapped[str] = mapped_column(String(160), default="")
    phone: Mapped[str] = mapped_column(String(30), default="")
    twilio_sid: Mapped[str] = mapped_column(String(60), default="", index=True)
    status: Mapped[str] = mapped_column(String(20), default="queued")  # queued|in_progress|completed|failed
    simulated: Mapped[bool] = mapped_column(Boolean, default=False)
    transcript: Mapped[list] = mapped_column(JSON, default=list)  # [{speaker: munshi|supplier|raj, text}]
    outcome: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class OutboundMessage(Base):
    __tablename__ = "outbound_messages"
    id: Mapped[int] = mapped_column(primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), index=True)
    action_id: Mapped[int | None] = mapped_column(ForeignKey("actions.id"), nullable=True, index=True)
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("customers.id"), nullable=True)
    channel: Mapped[str] = mapped_column(String(20), default="whatsapp")
    to: Mapped[str] = mapped_column(String(60), default="")
    recipient_name: Mapped[str] = mapped_column(String(160), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="sent")  # sent|failed
    simulated: Mapped[bool] = mapped_column(Boolean, default=False)
    provider_sid: Mapped[str] = mapped_column(String(60), default="")
    error: Mapped[str] = mapped_column(String(300), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class PayLink(Base):
    __tablename__ = "pay_links"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"))
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("customers.id"), nullable=True)
    amount: Mapped[float] = mapped_column(Float)
    upi_uri: Mapped[str] = mapped_column(String(500))
    shop_name: Mapped[str] = mapped_column(String(160), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Brief(Base):
    __tablename__ = "briefs"
    id: Mapped[int] = mapped_column(primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), index=True)
    day: Mapped[date] = mapped_column(Date)
    text: Mapped[str] = mapped_column(Text)
    stats: Mapped[dict] = mapped_column(JSON, default=dict)
    sent: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class AppSetting(Base):
    __tablename__ = "app_settings"
    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    shop_id: Mapped[int | None] = mapped_column(ForeignKey("shops.id"), nullable=True, index=True)
    actor: Mapped[str] = mapped_column(String(80), default="system")
    event: Mapped[str] = mapped_column(String(80))
    ref: Mapped[str] = mapped_column(String(80), default="")
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
