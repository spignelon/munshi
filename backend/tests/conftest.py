import os
import tempfile

_tmp = tempfile.mkdtemp(prefix="munshi-test-")
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["GROQ_FAKE"] = "1"
os.environ["GROQ_API_KEY"] = ""
os.environ["USE_TURSO"] = "0"
os.environ["PUBLIC_BASE_URL"] = "http://testserver"
os.environ["CRON_SECRET"] = "cronsecret"

import itertools  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.services import tts  # noqa: E402

_counter = itertools.count(1)


@pytest.fixture(scope="session")
def client():
    tts._edge = lambda text, voice: _fake_audio()  # type: ignore  # no network in tests
    with TestClient(app) as c:
        yield c


async def _fake_audio():
    return b"ID3fake-mp3-bytes"


@pytest.fixture
def merchant(client):
    """A fresh merchant with their own demo-seeded shop (tests stay isolated)."""
    n = next(_counter)
    r = client.post("/api/auth/signup", json={"name": f"Owner{n}", "email": f"raj{n}@test.dev", "password": "password123", "phone": "9876543210"})
    assert r.status_code == 200, r.text
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    assert client.post("/api/shop/demo-data", headers=h).status_code == 200
    return h


@pytest.fixture
def admin(client):
    r = client.post("/api/auth/login", json={"email": "admin@munshi.app", "password": "admin12345"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


FULL_PLAN = "Stock check karo, supplier ko order do, udhaar wapas lao, aur purane customers ko offer bhejo."
