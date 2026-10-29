"""Deterministic stand-in for Groq (GROQ_FAKE=1) used by tests and offline dev."""
import json
import re


def fake_transcribe(audio: bytes) -> str:
    return "Stock check karo, supplier ko order do, aur udhaar wapas lao."


def _last_user(messages: list) -> str:
    for m in reversed(messages):
        if m["role"] == "user" and isinstance(m["content"], str):
            return m["content"]
    return ""


def fake_chat(purpose: str, messages: list) -> str:
    text = _last_user(messages).lower()
    if purpose == "plan":
        text = text.split("owner says:", 1)[-1]  # ignore the shop-data snapshot; only the utterance counts
        actions = []
        if any(w in text for w in ("stock", "order", "supplier", "maal", "restock")):
            actions.append({"type": "supplier_order", "supplier": "Shree Foods Distributors", "discount_ask_pct": 4})
        if any(w in text for w in ("udhaar", "udhar", "wapas lao", "paise", "dues", "collect")):
            actions.append({"type": "udhaar_reminders", "tone": "polite"})
        if any(w in text for w in ("customer", "winback", "wapas bulao", "offer", "festival")):
            actions.append({"type": "winback_offer", "offer": "10% chhoot is hafte"})
        if "loan" in text:
            actions.append({"type": "loan_offer"})
        if any(w in text for w in ("report", "stock")) and not any(a["type"] == "supplier_order" for a in actions):
            actions.append({"type": "stock_report"})
        reply = ("Theek hai, maine plan bana liya hai. Approve karein toh main kaam shuru kar dunga."
                 if actions else "Aaj ka hisaab theek hai. Kuch aur karna ho toh bataiye.")
        return json.dumps({"reply": reply, "actions": actions}, ensure_ascii=False)
    if purpose == "supplier_script":
        return json.dumps({
            "transcript": [
                {"speaker": "munshi", "text": "Namaste, main dukaan ki taraf se Munshi bol raha hoon. Stock ka order dena hai."},
                {"speaker": "supplier", "text": "Haan haan boliye, kya chahiye?"},
                {"speaker": "munshi", "text": "Ghee aur dry fruits ki list bhej raha hoon. Total maal ka rate kuch kam kar dijiye."},
                {"speaker": "supplier", "text": "Theek hai, 4 percent chhoot de dunga. Kal subah 11 baje tak pahunch jayega."},
                {"speaker": "munshi", "text": "Bahut badhiya. Order pakka. Dhanyavaad."},
            ],
            "discount_pct": 4, "eta": "kal subah 11 baje", "confirmed": True,
        }, ensure_ascii=False)
    if purpose == "supplier_turn":
        return json.dumps({"say": "Theek hai, order pakka. Dhanyavaad.", "done": True, "confirmed": True, "discount_pct": 4,
                           "eta": "kal subah 11 baje"}, ensure_ascii=False)
    if purpose == "winback_copy":
        return "Namaste {name} ji! Is hafte aapke liye khaas 10% chhoot hai. Aaiye, hamari dukaan par aapka intezaar hai."
    if purpose == "ocr":
        return {"entries": [{"name": "Gupta ji", "amount": 450, "note": "atta, daal"},
                            {"name": "Meena", "amount": 1200, "note": ""},
                            {"name": "Pappu", "amount": 300, "note": "chai patti"}]}
    if purpose == "inbound":
        return json.dumps({"say": "Namaste, bataiye kya karna hai?", "done": False}, ensure_ascii=False)
    return "ok"
