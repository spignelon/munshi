import html
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import HTMLResponse, Response
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import DB_KIND, get_db
from ..models import PayLink, Shop
from ..services import brief, settings_store, tts

router = APIRouter(prefix="/api")


@router.get("/health")
def health(db: Session = Depends(get_db)):
    s = get_settings()
    return {"ok": True, "db": DB_KIND, "mock_mode": settings_store.is_mock(db), "groq": bool(s.groq_api_key or s.groq_fake),
            "time": datetime.now(timezone.utc).isoformat()}


@router.get("/tts/play")
def tts_play(text: str = Query(max_length=tts.MAX_CHARS), sig: str = "", db: Session = Depends(get_db)):
    """Signed, public URL that Twilio <Play> fetches."""
    if not tts.verify(text, sig):
        raise HTTPException(403, "bad signature")
    audio, used = tts.synthesize(db, text)
    return Response(audio, media_type="audio/mpeg", headers={"X-TTS-Provider": used, "Cache-Control": "public, max-age=3600"})


@router.get("/pay/{code}", response_class=HTMLResponse)
def pay_page(code: str, db: Session = Depends(get_db)):
    link = db.query(PayLink).filter(PayLink.code == code).first()
    if not link:
        raise HTTPException(404, "Link expired")
    shop = html.escape(link.shop_name)
    return HTMLResponse(f"""<!doctype html><html lang="hi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{shop} – Pay</title><style>
body{{margin:0;font-family:system-ui,sans-serif;background:#F8F4EC;color:#111B33;display:grid;place-items:center;min-height:100vh}}
.c{{background:#fff;border:1px solid #eadfca;border-radius:20px;padding:28px;width:min(92vw,380px);text-align:center;box-shadow:0 10px 30px #111b3310}}
h1{{font-size:15px;letter-spacing:.08em;text-transform:uppercase;color:#a35a0d;margin:0 0 6px}}
.a{{font-size:44px;font-weight:700;margin:8px 0 4px}} p{{color:#5b6475;margin:4px 0 20px}}
a.b{{display:block;background:#E8912D;color:#111B33;font-weight:700;text-decoration:none;padding:14px;border-radius:12px}}
small{{display:block;margin-top:14px;color:#8a92a3}}</style></head><body><div class="c">
<h1>{shop}</h1><div class="a">₹{link.amount:,.0f}</div><p>Udhaar baaki — UPI ya Paytm se chukayein</p>
<a class="b" href="{html.escape(link.upi_uri)}">Pay with UPI / Paytm</a><small>Sent by Munshi on behalf of {shop}</small></div></body></html>""")


@router.get("/cron/evening-brief")
def cron_evening_brief(authorization: str = Header(default=""), db: Session = Depends(get_db)):
    secret = get_settings().cron_secret
    if not secret or authorization != f"Bearer {secret}":
        raise HTTPException(403, "forbidden")
    shops = db.query(Shop).filter(Shop.onboarded == True).all()  # noqa: E712
    n = 0
    for shop in shops:
        brief.build(db, shop, send=True)
        n += 1
    return {"briefs": n}
