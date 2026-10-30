import pytest

from .conftest import FULL_PLAN


def cmd(client, h, text):
    r = client.post("/api/agent/command", data={"text": text}, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def test_auth_and_roles(client, merchant, admin):
    assert client.post("/api/auth/signup", json={"name": "X", "email": "raj1@test.dev", "password": "password123"}).status_code == 409
    assert client.post("/api/auth/signup", json={"name": "X", "email": "bad", "password": "password123"}).status_code == 422
    assert client.post("/api/auth/signup", json={"name": "X", "email": "a@b.co", "password": "short"}).status_code == 422
    assert client.post("/api/auth/login", json={"email": "raj1@test.dev", "password": "wrongpass1"}).status_code == 401
    assert client.get("/api/dashboard").status_code == 401
    assert client.get("/api/auth/me", headers=merchant).json()["user"]["role"] == "merchant"
    assert client.get("/api/admin/status", headers=merchant).status_code == 403
    assert client.get("/api/admin/status", headers=admin).status_code == 200
    assert client.get("/api/auth/me", headers=admin).json()["user"]["role"] == "admin"


def test_demo_numbers_match_pitch(client, merchant):
    d = client.get("/api/dashboard", headers=merchant).json()
    assert d["udhaar"]["count"] == 41 and round(d["udhaar"]["total"]) == 38000
    assert d["lapsed_count"] == 60
    assert d["stock"]["festive_low_count"] == 12
    assert 40000 < d["stock"]["festive_order_total"] < 50000
    assert d["loan"]["amount"] == 50000


def test_tenant_isolation(client, merchant):
    other = client.post("/api/auth/signup", json={"name": "Other", "email": "other@test.dev", "password": "password123"}).json()
    oh = {"Authorization": f"Bearer {other['token']}"}
    plan = cmd(client, merchant, FULL_PLAN)["plan"]
    assert client.get(f"/api/plans/{plan['id']}", headers=oh).status_code == 404
    assert client.post(f"/api/plans/{plan['id']}/decision", json={"approve": True}, headers=oh).status_code == 404
    assert client.get("/api/udhaar", headers=oh).json()["total"] == 0


def test_full_plan_proposes_but_moves_nothing(client, merchant):
    out = cmd(client, merchant, FULL_PLAN)
    types = {a["type"]: a for a in out["plan"]["actions"]}
    assert {"supplier_order", "udhaar_reminders", "winback_offer"} <= set(types)
    assert types["supplier_order"]["status"] == "proposed" and 40000 < types["supplier_order"]["amount"] < 50000
    assert types["supplier_order"]["payload"]["supplier_name"] == "Shree Foods Distributors"
    assert types["udhaar_reminders"]["payload"]["customer_count"] == 41
    assert out["plan"]["status"] == "proposed"
    assert client.get("/api/udhaar", headers=merchant).json()["total"] == 38000  # nothing executed yet
    assert client.get(f"/api/plans/{out['plan']['id']}", headers=merchant).json()["messages"] == []


def test_approval_executes_in_mock_mode_with_audit_chain(client, merchant):
    plan = cmd(client, merchant, FULL_PLAN)["plan"]
    r = client.post(f"/api/plans/{plan['id']}/decision", json={"approve": True, "utterance": "haan karo"}, headers=merchant)
    assert r.status_code == 200, r.text
    p = r.json()["plan"]
    acts = {a["type"]: a for a in p["actions"]}
    so = acts["supplier_order"]
    assert so["status"] == "done" and so["simulated"] is True
    assert 2 <= so["result"]["discount_pct"] <= 5 and so["result"]["order_ref"].startswith("MUN-")
    assert so["amount"] < so["result"]["gross"]
    assert len(p["calls"]) == 1 and len(p["calls"][0]["transcript"]) >= 4 and p["calls"][0]["simulated"]
    assert acts["udhaar_reminders"]["result"]["sent"] == 41
    assert len([m for m in p["messages"] if "upi" in m["body"].lower() or "/api/pay/" in m["body"]]) >= 41
    assert all(m["simulated"] for m in p["messages"])
    assert acts["udhaar_reminders"]["result"]["recovered_simulated"] > 0
    assert client.get("/api/udhaar", headers=merchant).json()["total"] < 38000
    # every action traces back to the approval that authorised it
    assert p["approvals"][0]["utterance"] == "haan karo"
    audit = client.get("/api/audit", headers=merchant).json()
    assert any(e["event"] == "plan_approved" for e in audit) and any(e["event"] == "supplier_order_confirmed" for e in audit)
    # incoming stock now reflected in inventory
    ghee = next(x for x in client.get("/api/products", headers=merchant).json() if x["name"] == "Desi Ghee 1kg")
    assert ghee["incoming_qty"] > 0
    # cannot decide twice
    assert client.post(f"/api/plans/{plan['id']}/decision", json={"approve": True}, headers=merchant).status_code == 409


def test_partial_approval_and_reject(client, merchant):
    plan = cmd(client, merchant, FULL_PLAN)["plan"]
    ids = {a["type"]: a["id"] for a in plan["actions"]}
    r = client.post(f"/api/plans/{plan['id']}/decision", json={"approve": True, "action_ids": [ids["winback_offer"]]}, headers=merchant).json()["plan"]
    st = {a["type"]: a["status"] for a in r["actions"]}
    assert st["winback_offer"] == "done" and st["supplier_order"] == "rejected" and st["udhaar_reminders"] == "rejected"
    plan2 = cmd(client, merchant, FULL_PLAN)["plan"]
    r2 = client.post(f"/api/plans/{plan2['id']}/decision", json={"approve": False}, headers=merchant).json()["plan"]
    assert r2["status"] == "rejected" and all(a["status"] == "rejected" for a in r2["actions"])
    assert client.get("/api/udhaar", headers=merchant).json()["total"] == 38000


def test_spending_caps_block_orders(client, merchant):
    client.put("/api/shop", json={"per_order_cap": 10000}, headers=merchant)
    out = cmd(client, merchant, "supplier ko stock order do")
    so = next(a for a in out["plan"]["actions"] if a["type"] == "supplier_order")
    assert so["status"] == "blocked" and "per-order limit" in so["blocked_reason"]
    assert out["plan"]["status"] == "blocked"
    assert client.post(f"/api/plans/{out['plan']['id']}/decision", json={"approve": True}, headers=merchant).status_code == 409
    # daily cap: allow per-order but cap the day below one order
    client.put("/api/shop", json={"per_order_cap": 50000, "daily_spend_cap": 20000}, headers=merchant)
    so2 = next(a for a in cmd(client, merchant, "supplier ko order do")["plan"]["actions"] if a["type"] == "supplier_order")
    assert so2["status"] == "blocked" and "daily limit" in so2["blocked_reason"]


def test_daily_cap_counts_earlier_orders(client, merchant):
    client.put("/api/shop", json={"daily_spend_cap": 60000}, headers=merchant)
    first = cmd(client, merchant, "supplier ko order do")["plan"]
    client.post(f"/api/plans/{first['id']}/decision", json={"approve": True}, headers=merchant)
    second = next(a for a in cmd(client, merchant, "supplier ko order do")["plan"]["actions"] if a["type"] == "supplier_order")
    assert second["status"] == "blocked" and "daily limit" in second["blocked_reason"]


def test_haan_nahi_by_text(client, merchant):
    cmd(client, merchant, FULL_PLAN)
    out = cmd(client, merchant, "haan")
    assert out["decision"] == "approved" and "order pakka" in out["reply"]
    cmd(client, merchant, "loan chahiye")  # (udhaar reminders are on a 48h cooldown after the approval above)
    assert cmd(client, merchant, "nahi")["decision"] == "rejected"
    # a lookalike sentence is NOT an approval
    cmd(client, merchant, "supplier ko order do")
    out = cmd(client, merchant, "stock check karo")
    assert out["decision"] is None


def test_question_has_no_actions(client, merchant):
    out = cmd(client, merchant, "aaj ka hisaab kaisa hai")
    assert out["plan"]["actions"] == [] and out["plan"]["status"] == "executed"


def test_real_mode_without_credentials_fails_loudly(client, merchant, admin):
    client.put("/api/admin/settings", json={"values": {"mock_mode": False}}, headers=admin)
    try:
        plan = cmd(client, merchant, FULL_PLAN)["plan"]
        r = client.post(f"/api/plans/{plan['id']}/decision", json={"approve": True}, headers=merchant).json()["plan"]
        so = next(a for a in r["actions"] if a["type"] == "supplier_order")
        assert so["status"] == "failed" and "Twilio is not configured" in so["result"]["error"]
        rem = next(a for a in r["actions"] if a["type"] == "udhaar_reminders")
        assert rem["status"] == "failed" and not rem["simulated"]
        assert client.get("/api/udhaar", headers=merchant).json()["total"] == 38000  # nothing faked
    finally:
        client.put("/api/admin/settings", json={"values": {"mock_mode": True}}, headers=admin)


def test_manual_ledger_entry_and_single_reminder(client, merchant):
    r = client.post("/api/udhaar/entries", json={"name": "Naya Grahak", "phone": "9811111111", "amount": 500, "note": "atta"}, headers=merchant)
    cid = r.json()["id"]
    assert r.json()["balance"] == 500
    assert client.post("/api/udhaar/entries", json={"customer_id": cid, "amount": 200, "kind": "payment"}, headers=merchant).json()["balance"] == 300
    assert client.post(f"/api/udhaar/{cid}/remind", headers=merchant).status_code == 200
    assert client.post("/api/udhaar/entries", json={"name": "x", "amount": -5}, headers=merchant).status_code == 422


def test_ocr_scan_then_import(client, merchant):
    r = client.post("/api/udhaar/scan", files={"image": ("l.png", b"\x89PNGfake", "image/png")}, headers=merchant)
    assert r.status_code == 200
    entries = r.json()["entries"]
    assert len(entries) == 3 and entries[0]["name"] == "Gupta ji"
    before = client.get("/api/udhaar", headers=merchant).json()["total"]
    imp = client.post("/api/udhaar/import", json={"entries": [{"name": e["name"], "amount": e["amount"], "note": e["note"]} for e in entries]}, headers=merchant)
    assert imp.json()["imported"] == 3
    assert client.get("/api/udhaar", headers=merchant).json()["total"] == before + 450 + 1200 + 300
    assert client.post("/api/udhaar/scan", files={"image": ("l.txt", b"hi", "text/plain")}, headers=merchant).status_code == 415


def test_voice_command_uses_whisper(client, merchant):
    r = client.post("/api/agent/command", files={"audio": ("a.webm", b"x" * 2000, "audio/webm")}, headers=merchant)
    assert r.status_code == 200 and r.json()["voice"] is True and "supplier" in r.json()["transcript"]
    assert client.post("/api/agent/command", files={"audio": ("a.webm", b"x", "audio/webm")}, headers=merchant).status_code == 422


def test_admin_settings_mask_secrets_and_toggle(client, admin):
    client.put("/api/admin/settings", json={"values": {"twilio_account_sid": "ACabc", "twilio_auth_token": "supersecret1234", "tts_provider": "elevenlabs"}}, headers=admin)
    s = client.get("/api/admin/settings", headers=admin).json()["settings"]
    assert s["twilio_auth_token"] == "••••1234" and s["twilio_auth_token_set"] is True and "supersecret" not in str(s)
    client.put("/api/admin/settings", json={"values": {"twilio_auth_token": s["twilio_auth_token"]}}, headers=admin)  # echoing the mask keeps the secret
    assert client.get("/api/admin/status", headers=admin).json()["twilio"]["configured"] is True
    assert client.put("/api/admin/settings", json={"values": {"tts_provider": "bogus"}}, headers=admin).status_code == 422
    client.put("/api/admin/settings", json={"values": {"twilio_account_sid": "", "twilio_auth_token": "", "tts_provider": "edge"}}, headers=admin)


def test_tts_endpoints(client, merchant):
    from app.services import tts
    r = client.post("/api/tts/speak", json={"text": "Namaste ji"}, headers=merchant)
    assert r.status_code == 200 and r.headers["content-type"] == "audio/mpeg" and r.headers["x-tts-provider"] == "edge"
    assert client.get("/api/tts/play", params={"text": "hi", "sig": "bad"}).status_code == 403
    assert client.get("/api/tts/play", params={"text": "hi", "sig": tts.sign("hi")}).status_code == 200


def test_pay_page_and_cron(client, merchant):
    plan = cmd(client, merchant, "udhaar wapas lao")["plan"]
    r = client.post(f"/api/plans/{plan['id']}/decision", json={"approve": True}, headers=merchant).json()["plan"]
    link = next(m["body"] for m in r["messages"]).split("http://testserver")[1].split()[0]
    page = client.get(link)
    assert page.status_code == 200 and "upi://pay?pa=kumarstore%40paytm" in page.text
    assert client.get("/api/cron/evening-brief").status_code == 403
    ok = client.get("/api/cron/evening-brief", headers={"Authorization": "Bearer cronsecret"})
    assert ok.status_code == 200 and ok.json()["briefs"] >= 1
    assert client.get("/api/dashboard", headers=merchant).json()["brief"]["text"].startswith("Aaj ka hisaab")


def test_admin_password_follows_environment(client, monkeypatch):
    """Rotating ADMIN_PASSWORD in the environment must replace a previously stored (e.g. weak dev) password."""
    from app import seed
    from app.config import get_settings
    from app.db import SessionLocal
    monkeypatch.setattr(get_settings(), "admin_password", "rotated-secret-99")
    with SessionLocal() as db:
        seed.bootstrap(db)
    assert client.post("/api/auth/login", json={"email": "admin@munshi.app", "password": "rotated-secret-99"}).status_code == 200
    assert client.post("/api/auth/login", json={"email": "admin@munshi.app", "password": "admin12345"}).status_code == 401
    monkeypatch.setattr(get_settings(), "admin_password", "admin12345")
    with SessionLocal() as db:
        seed.bootstrap(db)


def test_yes_no_detection_in_both_scripts():
    from app.services.agent import classify_reply as c
    for t in ["haan", "Haan karo", "haan ji", "ok theek hai", "हाँ कर दो", "हाँ कर दो।", "हां", "जी हाँ", "ठीक है", "बिल्कुल", "ओके", "yes"]:
        assert c(t) == "yes", t
    for t in ["nahi", "nahi mat karo", "नहीं", "नहीं मत करो", "रुको", "cancel"]:
        assert c(t) == "no", t
    # sentences that merely contain yes-ish words are NOT approvals
    for t in ["stock check karo", "स्टॉक चेक करो, सप्लायर को ऑर्डर दो, और उधार वापस लाओ", "ji", "कर दो", "do", "aaj ki sales kaisi rahi", "सप्लायर को ऑर्डर दो"]:
        assert c(t) is None, t
