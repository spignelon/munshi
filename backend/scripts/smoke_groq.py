"""Live end-to-end smoke test against the real Groq API (a handful of calls; respects free-tier limits).

    cd backend && .venv/bin/python scripts/smoke_groq.py
Uses a throwaway SQLite DB. Needs GROQ_API_KEY in backend/.env.
"""
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.mkdtemp()}/smoke.db"
os.environ["GROQ_FAKE"] = "0"

from app import seed  # noqa: E402
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.models import Shop  # noqa: E402
from app.services import command, executor, groq_client  # noqa: E402

Base.metadata.create_all(engine)
with SessionLocal() as db:
    seed.bootstrap(db)
    shop = db.query(Shop).filter(Shop.owner_id == 2).one()
    seed.seed_demo(db, shop)

    def say(text):
        t = time.time()
        r = command.run(db, shop, text)
        print(f"\n> {text}\n  [{time.time() - t:.1f}s] MUNSHI: {r['reply']}")
        for a in (r["plan"].actions if r["plan"] else []):
            print(f"   - {a.type:17} {a.status:9} {a.title}")
        return r

    r = say("Diwali aa rahi hai. Stock check karo, Sharma ji ko order do, aur udhaar wapas lao.")
    r2 = say("haan")
    print("\nSummary:", executor.summarize(r["plan"]))
    cs = next(a for a in r["plan"].actions if a.type == "supplier_order").result
    print("Call result:", {k: cs[k] for k in ("discount_pct", "eta", "final_amount") if k in cs})
    say("aaj ki sales kaisi rahi?")
    print("\nGroq usage:", groq_client.usage_snapshot()["openai/gpt-oss-120b"])
