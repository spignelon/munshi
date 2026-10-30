"""Sarvam voice provider + hands-free voice turns. The Sarvam HTTP layer is mocked: tests never spend credits."""
import base64

import httpx
import pytest

from app.db import SessionLocal
from app.models import AppSetting
from app.services import sarvam, speech, tts

WAV = b"RIFF" + b"\x00" * 6000  # content is irrelevant to the mocked providers; only size matters (> MIN_AUDIO)


def _resp(status, payload):
    return httpx.Response(status, json=payload, request=httpx.Request("POST", "https://api.sarvam.ai/x"))


class FakeSarvam:
    def __init__(self, transcripts=("stock check karo, supplier ko order do",), status=200):
        self.calls, self.transcripts, self.status = [], list(transcripts), status

    def __call__(self, path, key, **kw):
        self.calls.append(path)
        assert key == "test-key"
        if self.status != 200:
            return _resp(self.status, {"error": {"message": "nope"}})
        if path == "/speech-to-text":
            t = self.transcripts.pop(0) if len(self.transcripts) > 1 else self.transcripts[0]
            return _resp(200, {"transcript": t, "language_code": "hi-IN"})
        return _resp(200, {"audios": [base64.b64encode(b"ID3sarvam-mp3").decode()]})


@pytest.fixture
def sarvam_on(client, admin, monkeypatch):
    def put(values):
        assert client.put("/api/admin/settings", json={"values": values}, headers=admin).status_code == 200
    put({"sarvam_api_key": "test-key", "stt_provider": "sarvam", "tts_provider": "sarvam", "sarvam_budget_inr": "85"})
    tts._cache.clear()
    fake = FakeSarvam()
    monkeypatch.setattr(sarvam, "_post", fake)
    yield fake, put
    put({"sarvam_api_key": "", "stt_provider": "sarvam", "tts_provider": "sarvam", "sarvam_budget_inr": "85"})
    with SessionLocal() as db:
        db.query(AppSetting).filter(AppSetting.key.like("usage_sarvam_%")).delete(synchronize_session=False)
        db.commit()
    tts._cache.clear()


def turn(client, h, audio=WAV, duration=3.0):
    return client.post("/api/voice/turn", files={"audio": ("voice.wav", audio, "audio/wav")}, data={"duration": str(duration)}, headers=h)


def test_voice_turn_requires_auth(client):
    assert client.post("/api/voice/turn", files={"audio": ("v.wav", WAV, "audio/wav")}).status_code == 401


def test_turn_uses_sarvam_for_both_directions_and_meters_usage(client, merchant, admin, sarvam_on):
    fake, _ = sarvam_on
    r = turn(client, merchant)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["providers"] == {"stt": "sarvam", "tts": "sarvam"}
    assert d["transcript"].startswith("stock check") and not d["empty"]
    assert any(a["type"] == "supplier_order" for a in d["plan"]["actions"])  # same planner/approval pipeline as typed commands
    tts_calls = [c for c in fake.calls if c == "/text-to-speech"]
    assert fake.calls[0] == "/speech-to-text" and 1 <= len(tts_calls) <= 3 and len(fake.calls) == 1 + len(tts_calls)
    # long replies are synthesized as parallel sentence chunks and the MP3 frames are concatenated
    assert base64.b64decode(d["audio"]) == b"ID3sarvam-mp3" * len(tts_calls) and d["audio_mime"] == "audio/mpeg"
    u = client.get("/api/admin/status", headers=admin).json()["sarvam"]
    assert u["configured"] and u["usage"]["tts_chars"] > 0 and u["usage"]["stt_minutes"] == 0.05  # 3 s


def test_voice_approval_flow(client, merchant, sarvam_on):
    fake, _ = sarvam_on
    fake.transcripts = ["supplier ko stock order do", "haan"]
    first = turn(client, merchant).json()
    assert first["plan"]["status"] == "proposed"
    second = turn(client, merchant).json()
    assert second["decision"] == "approved"
    assert next(a for a in second["plan"]["actions"] if a["type"] == "supplier_order")["status"] == "done"
    assert client.get("/api/udhaar", headers=merchant).status_code == 200


def test_out_of_credits_falls_back_to_groq_and_edge(client, merchant, sarvam_on):
    fake, _ = sarvam_on
    fake.status = 402
    d = turn(client, merchant).json()
    assert d["providers"] == {"stt": "groq", "tts": "edge"}  # the turn still works
    assert d["transcript"] and d["audio"]


def test_budget_guard_stops_calling_sarvam(client, merchant, sarvam_on):
    fake, put = sarvam_on
    put({"sarvam_budget_inr": "0"})
    d = turn(client, merchant).json()
    assert fake.calls == [] and d["providers"]["stt"] == "groq" and d["providers"]["tts"] == "edge"


def test_groq_selected_explicitly(client, merchant, sarvam_on):
    fake, put = sarvam_on
    put({"stt_provider": "groq", "tts_provider": "edge"})
    d = turn(client, merchant).json()
    assert fake.calls == [] and d["providers"] == {"stt": "groq", "tts": "edge"}


def test_tiny_audio_is_ignored_without_cost(client, merchant, sarvam_on):
    fake, _ = sarvam_on
    assert turn(client, merchant, audio=b"x" * 500).json() == {"empty": True, "transcript": ""}
    assert fake.calls == []


def test_unintelligible_transcript_is_rejected_not_executed(client, merchant, sarvam_on):
    fake, _ = sarvam_on
    fake.transcripts = ["Að kjá kjá var sakta meða business kvíliða."]  # the garbled Whisper output seen in the field
    d = turn(client, merchant).json()
    assert d["empty"] is True and fake.calls == ["/speech-to-text"]  # no planning, no TTS credits
    assert client.get("/api/plans", headers=merchant).json() == []


def test_garble_detector():
    assert speech.looks_garbled("Að kjá kjá var sakta meða business kvíliða.")
    assert speech.looks_garbled("") and speech.looks_garbled("a")
    for ok in ["आप क्या क्या कर सकते हैं मेरे business के लिए?", "stock check karo, supplier ko order do", "दिवाली आ रही है। stock check करो ₹5,000", "haan"]:
        assert not speech.looks_garbled(ok), ok


def test_speech_text_trims_at_sentence_boundary():
    long = "Pehla vaakya yahan hai. " * 30
    out = tts.speech_text(long, 100)
    assert len(out) <= 100 and out.endswith(".")
    assert tts.speech_text("chhota sa jawab") == "chhota sa jawab"


def test_admin_validates_and_masks_sarvam(client, admin, sarvam_on):
    assert client.put("/api/admin/settings", json={"values": {"stt_provider": "bogus"}}, headers=admin).status_code == 422
    assert client.put("/api/admin/settings", json={"values": {"sarvam_budget_inr": "-3"}}, headers=admin).status_code == 422
    s = client.get("/api/admin/settings", headers=admin).json()
    assert s["settings"]["sarvam_api_key"] == "••••-key" and "test-key" not in str(s)
    assert any(x["id"] == "simran_hi_assistant" for x in s["sarvam_speakers"])


def test_typed_turn_skips_speech_to_text(client, merchant, sarvam_on):
    fake, _ = sarvam_on
    r = client.post("/api/voice/turn", data={"text": "supplier ko stock order do"}, headers=merchant)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["transcript"] == "supplier ko stock order do" and d["providers"]["stt"] is None and d["providers"]["tts"] == "sarvam"
    assert "/speech-to-text" not in fake.calls  # no STT credits for typed input
    assert any(a["type"] == "supplier_order" for a in d["plan"]["actions"])
    # typed "haan" approves the pending plan through the same endpoint
    d2 = client.post("/api/voice/turn", data={"text": "haan"}, headers=merchant).json()
    assert d2["decision"] == "approved"
    assert client.post("/api/voice/turn", headers=merchant).status_code == 422  # neither audio nor text
