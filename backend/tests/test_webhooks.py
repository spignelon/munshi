from .conftest import FULL_PLAN


def _shop_phone(client, h, phone="+919811122233"):
    client.put("/api/shop", json={"whatsapp_number": phone}, headers=h)
    return phone


def test_whatsapp_unknown_sender(client):
    r = client.post("/api/webhooks/whatsapp", data={"From": "whatsapp:+919000000000", "Body": "hi"})
    assert r.status_code == 200 and "<Message>" in r.text and "account" in r.text


def test_whatsapp_command_then_haan(client, merchant):
    phone = _shop_phone(client, merchant)
    r = client.post("/api/webhooks/whatsapp", data={"From": f"whatsapp:{phone}", "Body": FULL_PLAN, "NumMedia": "0"})
    assert "Shree Foods Distributors ko phone" in r.text and "haan" in r.text
    r2 = client.post("/api/webhooks/whatsapp", data={"From": f"whatsapp:{phone}", "Body": "Haan karo", "NumMedia": "0"})
    assert "order pakka" in r2.text
    plans = client.get("/api/plans", headers=merchant).json()
    assert plans[0]["channel"] == "whatsapp" and plans[0]["approvals"][0]["channel"] == "whatsapp"


def test_supplier_call_turn_loop(client, merchant):
    """Real-mode TwiML flow, exercised with the webhooks directly (signature check skipped in mock mode without a token)."""
    from app.db import SessionLocal
    from app.models import Action, CallSession, Shop
    plan = client.post("/api/agent/command", data={"text": "supplier ko order do"}, headers=merchant).json()["plan"]
    aid = next(a["id"] for a in plan["actions"] if a["type"] == "supplier_order")
    with SessionLocal() as db:
        act = db.get(Action, aid)
        act.status = "executing"
        cs = CallSession(shop_id=act.shop_id, action_id=aid, counterpart="Shree Foods Distributors", status="queued", transcript=[])
        db.add(cs)
        db.commit()
        cs_id = cs.id
    r = client.post(f"/api/webhooks/voice/supplier?cs={cs_id}")
    assert "<Play>" in r.text and "/api/tts/play" in r.text and "<Record" in r.text and "/voice/supplier/turn" in r.text
    r = client.post(f"/api/webhooks/voice/supplier/turn?cs={cs_id}", data={})  # no recording => unclear, but fake LLM confirms
    assert "<Hangup" in r.text
    with SessionLocal() as db:
        act = db.get(Action, aid)
        assert act.status == "done" and act.result["confirmed"] and act.result["order_ref"]
        assert db.get(CallSession, cs_id).status == "completed"


def test_call_status_failure_marks_action(client, merchant):
    from app.db import SessionLocal
    from app.models import Action, CallSession
    plan = client.post("/api/agent/command", data={"text": "supplier ko order do"}, headers=merchant).json()["plan"]
    aid = next(a["id"] for a in plan["actions"] if a["type"] == "supplier_order")
    with SessionLocal() as db:
        act = db.get(Action, aid)
        act.status = "executing"
        cs = CallSession(shop_id=act.shop_id, action_id=aid, status="queued", transcript=[])
        db.add(cs)
        db.commit()
        cs_id = cs.id
    assert client.post(f"/api/webhooks/voice/status?cs={cs_id}", data={"CallStatus": "no-answer"}).status_code == 204
    with SessionLocal() as db:
        assert db.get(Action, aid).status == "failed" and "uthaya" in db.get(Action, aid).result["error"]


def test_inbound_call_greets_known_owner(client, merchant):
    phone = _shop_phone(client, merchant, "+919822233344")
    r = client.post("/api/webhooks/voice/inbound", data={"From": phone})
    assert "<Play>" in r.text and "<Record" in r.text
    r = client.post("/api/webhooks/voice/inbound", data={"From": "+911111111111"})
    assert "<Hangup" in r.text


def test_twilio_signature_enforced_when_real(client, admin):
    client.put("/api/admin/settings", json={"values": {"mock_mode": False, "twilio_auth_token": "tok12345"}}, headers=admin)
    try:
        r = client.post("/api/webhooks/whatsapp", data={"From": "whatsapp:+919000000000", "Body": "hi"})
        assert r.status_code == 403
    finally:
        client.put("/api/admin/settings", json={"values": {"mock_mode": True, "twilio_auth_token": ""}}, headers=admin)
        from app.db import SessionLocal
        from app.models import AppSetting
        with SessionLocal() as db:
            db.query(AppSetting).filter(AppSetting.key == "twilio_auth_token").delete()
            db.commit()
