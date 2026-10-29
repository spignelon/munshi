# Munshi — *Raj speaks. Munshi gets it done.*

A voice-first AI business partner for Paytm kirana merchants, built from the **Team MalaAI · Munshi** pitch.
Raj says one Hinglish sentence — *"Diwali aa rahi hai. Stock check karo, Sharma ji ko order do, aur udhaar wapas lao."* —
and Munshi **listens → thinks → acts → checks with Raj**: it plans the work, phones the supplier, sends udhaar reminders with
Paytm/UPI pay links, wins lapsed regulars back, and **does nothing that moves money until Raj says "haan"**, within hard spending caps.

| | |
|---|---|
| **Live app** | https://munshi-web-navy.vercel.app (click **Try the live demo**) |
| **API** | https://munshi-api-indol.vercel.app (`/api/docs` for Swagger, `/api/health`) |
| **Stack** | FastAPI · React + Vite + TypeScript + Tailwind v4 · SQLite / Turso (libSQL) · Groq · Twilio · edge-tts / ElevenLabs |

---

## What it does (mapped to the pitch)

| Pitch chapter | In the product |
|---|---|
| **Listens** — Hinglish voice, noisy-shop ready | Mic button (web), WhatsApp voice notes, inbound phone calls → Groq **`whisper-large-v3-turbo`** (Hindi hint + Hinglish prompt) |
| **Thinks** — agent reads sales, udhaar, stock | Groq **`openai/gpt-oss-120b`** plans from a compact snapshot of Paytm sales, udhaar, festive stock, lapsed regulars, suppliers |
| **Acts** — calls, WhatsApp, UPI links, orders | Supplier phone calls (Twilio Voice, turn-by-turn Whisper ↔ LLM ↔ TTS), WhatsApp reminders with pay links (Twilio WhatsApp sandbox), win-back offers, loan pre-offer, evening brief |
| **Checks** — "no rupee moves until Raj says haan" | Plan cards with per-action approve/reject, `haan`/`nahi` by text, voice, or WhatsApp; per-order + daily spend caps enforced **again at execution**; every action links to the approval record; full audit log |
| Udhaar notebook (red *lal copy*) | Ledger with manual entries, one-tap reminders, and **photo scan** of the handwritten notebook via Groq vision **`qwen/qwen3.8-27b`** → review/edit → import |
| Diwali stock gap | Festive forecast: items that sold ≥2× last Diwali and are now short, grouped by supplier with order value |
| Evening brief (10 pm) | Daily brief generated on demand or by Vercel Cron, sent on WhatsApp |

Seed data ("Raj Kirana Store, Lajpat Nagar") reproduces the pitch story: ₹38,000 udhaar across 41 customers, 60 silent regulars, 12 festive items short (≈₹45.6K order from Sharma Distributors, ~₹1.8K negotiated off), ₹50,000 loan pre-offer.

### Design decision: one planning call, not a tool loop
Groq's free tier gives `gpt-oss-120b` only **8,000 tokens/min** (30 RPM, 1K req/day). A multi-round tool-calling loop would blow that budget, so
deterministic code pre-fetches a ~250-token business snapshot and the model makes **one structured call**: reply in Hinglish + choose actions.
Quantities, rupee amounts and recipient lists are computed by code (`services/business.py`), never by the LLM, and
`services/guardrails.py` vets them. "The agent proposes; fixed rules approve."

---

## Architecture

```
 React (Vite) ──/api/*──▶ FastAPI ──▶ SQLAlchemy ──▶ SQLite (local) | Turso libSQL (Vercel)
 Vercel project              │
 munshi-web (rewrite)        ├─ services/agent.py        planner (gpt-oss-120b) → Plan + Actions
                             ├─ services/guardrails.py   caps, cooldowns, approval required
                             ├─ services/executor.py     approve → run actions → audit trail
                             ├─ services/telephony.py    Twilio calls (real) / LLM-written call (mock)
                             ├─ services/messaging.py    WhatsApp sandbox (real) / recorded (mock)
                             ├─ services/tts.py          edge-tts (default) or ElevenLabs
                             ├─ services/groq_client.py  rate-limit aware: chat / Whisper / vision
                             └─ routers/webhooks.py      Twilio WhatsApp + voice (signature-verified)
```

```
backend/   FastAPI app (app/), tests/, scripts/smoke_groq.py, vercel.json (sin1 region + cron)
frontend/  React app (src/), e2e/ Playwright specs, vercel.json (rewrites /api → API project)
```

### Mock mode (the toggle)
Admin → **Providers → Mock mode**. While ON, Twilio calls/WhatsApp, ElevenLabs and payment collection are **simulated** and tagged *Simulated* everywhere in the UI
(the supplier call transcript is LLM-written; ~25% of reminded customers "pay by lunch"). While OFF, real providers are used and
**missing credentials produce a clear error on the action** (e.g. *"Twilio is not configured"*) — nothing is silently faked. Groq is always real.
Flip it off after adding keys; no code change needed.

---

## Run locally

Prereqs: Python 3.12+, [uv](https://docs.astral.sh/uv/), Node 20+.

```bash
# Backend
cd backend
uv venv .venv && uv pip install --python .venv/bin/python -r requirements-dev.txt
cp .env.example .env            # add GROQ_API_KEY (and optional keys below)
.venv/bin/uvicorn index:app --reload --port 8000

# Frontend (second terminal)
cd frontend
npm install
npm run dev                     # http://localhost:5173 (proxies /api → :8000)
```

Open http://localhost:5173 → **Try the live demo**. Admin login: `ADMIN_EMAIL` / `ADMIN_PASSWORD` from your `.env`
(defaults `admin@munshi.app` / `admin12345` — **change them**; the admin password is re-synced from the env on every start).

### Environment variables (`backend/.env`)

| Var | Purpose |
|---|---|
| `GROQ_API_KEY` | **Required.** Planner, Whisper, vision |
| `JWT_SECRET`, `TTS_SIGNING_SECRET`, `CRON_SECRET` | Random secrets (`openssl rand -hex 32`) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Bootstrap admin (source of truth — rotating it rotates the login) |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Hosted SQLite. Used automatically on Vercel; locally only when `USE_TURSO=1` |
| `DATABASE_URL` | Optional explicit SQLAlchemy URL override |
| `PUBLIC_BASE_URL` | The API's public URL (used in Twilio callbacks, TTS URLs and pay links) |
| `FESTIVAL_NAME`, `FESTIVAL_DATE` | Default `Diwali`, `2026-11-08` |
| `GROQ_FAKE=1` | Deterministic fake Groq (tests/offline) |
| `TWILIO_*`, `ELEVENLABS_*` | Optional env fallbacks — normally set in **Admin → Providers** (DB values win; secrets are masked in the UI) |

---

## Connecting the real providers (do this when you have keys)

All of this is configured from **Admin → Providers** in the app (log in as admin). No redeploy needed.

### Twilio WhatsApp sandbox
1. Twilio Console → *Messaging → Try it out → Send a WhatsApp message*. From your phone, WhatsApp `join <your-code>` to the sandbox number (re-join every 72 h).
2. Admin → Providers: set **Account SID**, **Auth token**, **WhatsApp sandbox sender** (`whatsapp:+14155238886`).
3. In the Twilio sandbox settings paste the **"When a message comes in"** URL shown in the app (`https://<api>/api/webhooks/whatsapp`).
4. Set **your own WhatsApp number** in the app's *Settings → Aapka WhatsApp number* — Munshi recognises your "haan", voice notes and ledger photos by this number.
5. Sandbox rule: you can only message numbers that joined the sandbox, and free-form messages only within 24 h of their last message to you.

### Twilio Voice (supplier calls + calling Munshi)
1. Buy/verify a voice-capable Twilio number; enter it as **Voice number**.
2. Paste the **"A call comes in"** URL from the app into that number's config to let Raj *call Munshi* (identified by his WhatsApp number).
3. Outbound supplier calls use `<Play>` (signed TTS URL) + `<Record>` per turn: recording → Whisper → LLM → next line, max 6 turns, then the order is recorded with discount + ETA. Trial accounts can only call verified numbers.

### ⚠️ Safety while testing: **Test redirect number**
The seed data uses deliberately **invalid** phone numbers so nothing real can be contacted. In real mode, set **Test redirect number** to your sandbox-joined phone:
*every* customer/supplier message and call is then redirected to it, and bulk sends are capped at 3. Clear it only for genuine use.

Use **Send test WhatsApp** / **Place test call** in the admin panel to verify credentials. Turn **Mock mode OFF** when ready.

### ElevenLabs (optional)
Admin → Providers → **Voice → ElevenLabs**: paste API key + Voice ID (model defaults to `eleven_multilingual_v2`) → *Preview voice* → *Save voice*.
If the key is missing or ElevenLabs errors, speech silently falls back to the free **edge-tts** Hindi voices (`hi-IN-SwaraNeural` / `hi-IN-MadhurNeural`).

### Groq free-tier limits (respected in code)
`services/groq_client.py` keeps a sliding 60 s window per model (≈85 % of 30 RPM / 8K TPM), waits briefly or returns a friendly *"Munshi is busy, try in N s"* (HTTP 429 → UI toast),
honours `retry-after`, and records Groq's `x-ratelimit-*` headers. Admin → System shows live usage. One command costs ~0.3–0.6K tokens; a notebook-photo scan ~2K.

---

## Testing

```bash
# Backend: 24 tests (auth/RBAC, tenant isolation, caps, approval gate, mock vs real, webhooks, OCR, admin, TTS…)
cd backend && .venv/bin/python -m pytest -q

# Live Groq smoke (a handful of real calls on a throwaway DB)
cd backend && .venv/bin/python scripts/smoke_groq.py

# Frontend e2e (Playwright boots the real API on :8011 with a fresh DB + Vite on :5174; fake Groq, fake mic = hindi.wav)
cd frontend && npx playwright install chromium && npx playwright test
E2E_LIVE=1 GROQ_API_KEY=… npx playwright test e2e/munshi.spec.ts   # same journey on real Groq

# Production smoke
E2E_BASE_URL=https://munshi-web-navy.vercel.app npx playwright test e2e/smoke.spec.ts
```
The e2e suite covers: route protection, signup → onboarding → dashboard → logout → login, the full pitch journey
(plan → nothing moves → approve → results → audit trail), rejection, spending-cap block, `haan` by text, **mic recording with a real Hindi clip**, notebook photo scan → import,
manual ledger entries, admin mock/TTS/Twilio settings + secret masking, and no-overflow checks on desktop and mobile (Pixel 7).

---

## Deploying to Vercel (two projects, one repo)

```bash
# 1. API  (root: backend/)
cd backend
vercel link --project <api-project>
# set env: GROQ_API_KEY TURSO_DATABASE_URL TURSO_AUTH_TOKEN JWT_SECRET TTS_SIGNING_SECRET CRON_SECRET ADMIN_EMAIL ADMIN_PASSWORD PUBLIC_BASE_URL
vercel deploy --prod

# 2. Web  (root: frontend/) — edit frontend/vercel.json: point the /api rewrite at YOUR api alias
cd ../frontend && vercel link --project <web-project> && vercel deploy --prod
```
* `backend/vercel.json` pins the function to **`sin1`** (next to the Turso DB in `aws-ap-southeast-1`) — cross-ocean round-trips make every query slow — and registers a daily cron
  (`/api/cron/evening-brief`, 22:00 IST) authenticated with `CRON_SECRET`.
* `PUBLIC_BASE_URL` must be the API's real production alias (not a guess — `*.vercel.app` names are global).
* The web project rewrites `/api/*` to the API, so the browser sees one origin (no CORS/cookies).
* Without Turso configured the API falls back to ephemeral `/tmp` SQLite and the admin System tab warns about it.

---

## Security notes
* Secrets live only in `backend/.env` (gitignored) and Vercel env. Twilio/ElevenLabs secrets are stored in the DB and **masked** in every API response.
* JWT bearer auth, bcrypt passwords, strict per-shop tenant isolation on every query, admin-only provider/settings endpoints.
* Twilio webhooks verify `X-Twilio-Signature` whenever mock mode is off. TTS URLs are HMAC-signed.
* "haan" detection is deliberately strict: only short utterances made *entirely* of yes/no words count, and only against a pending plan.

## Known limits / next steps
* **Loan offer is simulated** (no Paytm lending API) and labelled so. UPI pay links are real `upi://` deep links, but payment reconciliation is manual ("Mila") — a Paytm webhook would close the loop.
* Paytm Soundbox voice ingestion isn't wired (web, WhatsApp and phone are); the same `/api/agent/command` pipeline would serve it.
* Single-language UI copy is Hinglish; the planner and TTS are Hindi-first.
* Groq limits are per serverless instance (in-process); a shared limiter (Redis) would be needed at scale.

*Outcomes in the pitch are pilot targets from a demo dataset, not measured results.*
