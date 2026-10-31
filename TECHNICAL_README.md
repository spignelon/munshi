# Munshi — technical guide

> This is the engineering guide: architecture, setup, provider configuration, testing, deployment. For what Munshi does for a shop owner (with screenshots), see the [README](README.md).

Munshi is a voice-first AI assistant for small shop owners (built for Paytm merchants). The owner gives one instruction — by voice (default screen), text, WhatsApp or phone — such as
*"Stock check karo, supplier ko order do, aur udhaar wapas lao"*, and Munshi **listens → plans → asks for approval → acts**: it works out what is running low,
phones the supplier, WhatsApps udhaar reminders with UPI pay links, invites back customers who stopped visiting, and logs everything.
**Nothing that moves money runs without the owner's approval**, and hard spending caps are enforced on top.

| | |
|---|---|
| **Live app** | https://munshi-web-navy.vercel.app (click **Try the live demo**; installable as an app) |
| **API** | https://munshi-api-indol.vercel.app (`/api/docs` for Swagger, `/api/health`) |
| **Stack** | FastAPI · React + Vite + TypeScript + Tailwind v4 (PWA) · SQLite / Turso (libSQL) · Groq · Sarvam · Twilio · edge-tts / ElevenLabs |

---

## Features

| Area | What it does |
|---|---|
| **Voice mode** (default screen; there is no chat view) | A full-screen, hands-free conversation (like ChatGPT voice) with an animated avatar — a stylized SVG character (not photoreal) whose mouth follows the real reply audio (Web Audio analyser) and which has listening / hearing / thinking / speaking / error / muted states. Munshi listens continuously, detects when you stop talking, answers in voice, and you can interrupt it. Say “haan” / “nahi” to approve or reject a plan, or tap the buttons. Only detected speech is uploaded |
| **Voice & text** | Mic button, WhatsApp voice notes and phone calls. Speech-to-text: **Sarvam Saaras** (built for Indian languages, `codemix` mode keeps English words in Hinglish) with automatic fallback to Groq **`whisper-large-v3-turbo`**. Speech out: **Sarvam Bulbul**, edge-tts or ElevenLabs |
| **Planning** | Groq **`openai/gpt-oss-120b`** reads a compact snapshot of Paytm sales, udhaar, stock, lapsed customers and suppliers, replies in the owner's language and proposes actions |
| **Actions** | Supplier phone calls (Twilio Voice, per-turn STT ↔ LLM ↔ TTS), udhaar reminders by WhatsApp (UPI/Paytm pay link), by spoken phone call, or both (`reminder_channel`; the owner can also say it: "call nahi, bas WhatsApp"; can target one named customer), win-back offers, working-capital loan pre-offer, stock report, daily summary |
| **Approvals & safety** | Plan cards with per-action approve/reject; `haan`/`yes`/`nahi` by text, voice or WhatsApp; per-order and daily spend caps re-checked at execution; reminder cooldown; every action links to its approval; audit log |
| **Udhaar ledger** | Manual entries, one-tap reminders, and **photo scan** of a handwritten notebook via Groq vision **`qwen/qwen3.8-27b`** → review/edit → import |
| **Stock forecast** | Flags items that sold ≥2× normal in last year's festival window and are now short, grouped by supplier with order value (festival name/date are configurable) |
| **Admin console** | Mock-mode toggle, STT/TTS provider (Sarvam / Groq / Edge / ElevenLabs), Sarvam credit meter, Twilio credentials + WhatsApp template SID, reminder channel, test redirect number, connection tests, Groq usage, DB status, users |
| **PWA** | Installable on Chrome / Android / desktop, offline fallback, mobile-first UI |

The demo store ("Kumar General Store") is generated sample data: 90 days of Paytm sales, 41 udhaar customers (₹38,000), 60 lapsed customers, 40 products with 12 festival items running low, and 5 suppliers.

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
                             ├─ services/sarvam.py       Saaras STT + Bulbul TTS, credit metering, fallbacks
                             ├─ services/speech.py       STT with Sarvam → Groq Whisper fallback
                             ├─ services/tts.py          Sarvam / edge-tts / ElevenLabs
                             ├─ routers/voice.py         POST /api/voice/turn (audio or typed text → plan + spoken reply)
                             ├─ services/groq_client.py  rate-limit aware: chat / Whisper / vision
                             └─ routers/webhooks.py      Twilio WhatsApp + voice (signature-verified)
```

```
backend/   FastAPI app (app/), tests/, scripts/smoke_groq.py, vercel.json (sin1 region + cron)
frontend/  React app (src/), e2e/ Playwright specs, vercel.json (rewrites /api → API project)
docs/      README screenshots (regenerate: see Testing)
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
| `FESTIVAL_NAME`, `FESTIVAL_DATE` | Upcoming festival used by the stock forecast (default `Diwali`, `2026-11-08`); rolls to next year once passed |
| `GROQ_FAKE=1` | Deterministic fake Groq (tests/offline) |
| `TWILIO_*`, `ELEVENLABS_*` | Optional env fallbacks — normally set in **Admin → Providers** (DB values win; secrets are masked in the UI) |

---

## Connecting the real providers (do this when you have keys)

All of this is configured from **Admin → Providers** in the app (log in as admin). No redeploy needed.

### Twilio WhatsApp
1. Twilio Console → *Messaging → Try it out → Send a WhatsApp message*. From your phone, WhatsApp `join <your-code>` to the sandbox number (re-join every 72 h).
2. Admin → Providers: set **Account SID**, **Auth token**, **WhatsApp sender** (`whatsapp:+14155238886` for the classic sandbox, or your Tryout number).
3. In the sandbox settings paste the **"When a message comes in"** URL shown in the app (`https://<api>/api/webhooks/whatsapp`). Replies to *inbound* messages are TwiML responses and always work as free text.
4. Set **your own WhatsApp number** in *Settings → Aapka WhatsApp number* — Munshi recognises your "haan", voice notes and ledger photos by this number.
5. **Trial / "Tryout" senders reject free-text API sends** (`HTTP 400 … ContentSid Required`) — only approved templates are allowed. Set **WhatsApp template SID** (`HX…`) and **Template variables** (JSON, `{text}` is replaced by Munshi's message, e.g. `{"1": "{text}"}`) in Admin → Twilio. On a **trial** account Twilio allows only `to`, `from`, `ContentSid` and `statusCallback` (no `Body`, no `ContentVariables`), so set the variables to `{}` and the sender's fixed sample template is sent as-is; custom text needs a paid account. Without a template Munshi records the failure with that explanation. The Content API itself is locked on trial accounts, so the SID must be copied from the Twilio console snippet.
6. Sandbox rule: you can only message numbers that joined the sandbox, and free-form messages only within 24 h of their last message to you.

### Twilio Voice (supplier calls, reminder calls, calling Munshi)
1. Buy/verify a voice-capable Twilio number; enter it as **Voice number**.
2. Optional: paste the **"A call comes in"** URL into that number's config to let the owner *call Munshi* (identified by the WhatsApp number saved in Settings).
3. Outbound supplier calls use `<Play>` (signed TTS URL, Sarvam voice) + `<Record>` per turn: recording → STT → LLM → next line, max 6 turns, then the order is recorded with discount + ETA. Udhaar reminder calls are one-way (`/voice/message`): the spoken text is stored on the `OutboundMessage`, played, then hung up. While a test redirect number is set, only one reminder call is placed per approval.
4. **Trial-account facts (verified against a live account):**
   * `Calls.create` accepts only `To`, `From`, `Url`, `StatusCallback`, `StatusCallbackEvent`. `Method`, `StatusCallbackMethod`, `Timeout` and inline `Twiml` fail with *"trial accounts have limited parameter access"* (a unit test pins the allowed set).
   * Call webhooks arrive **without an `X-Twilio-Signature` header**. Every webhook URL we hand to Twilio (`voice/test`, `voice/message`, `voice/supplier`, `…/turn`, `voice/status`) therefore carries a secret-derived `?k=` capability token (`tts.cap_token`, bound to path + call/message id) that is accepted when the signature is missing; a valid signature is still accepted, forged tokens get 403. Inbound endpoints (`/whatsapp`, `/voice/inbound`) still require a valid Twilio signature. A mismatch is logged as `twilio_sig_fail` (URL, field names, 6-char signature prefixes — no secrets).
   * Trial calls can only reach verified numbers and are capped at 10 minutes.

### ⚠️ Safety while testing: **Test redirect number**
The seed data uses deliberately **invalid** phone numbers so nothing real can be contacted. In real mode, set **Test redirect number** to your sandbox-joined phone:
*every* customer/supplier message and call is then redirected to it, and bulk sends are capped at 3. Clear it only for genuine use.

Use **Send test WhatsApp** / **Place test call** in the admin panel to verify credentials (the test call speaks a Devanagari Hindi greeting in the configured TTS voice). Turn **Mock mode OFF** when ready. When switching from mock to live, clear stale `last_reminded_at` stamps on the demo shop — simulated sends set them and the 48 h cooldown will otherwise block the first live reminder.

### ElevenLabs (optional)
Admin → Providers → **Voice → ElevenLabs**: paste API key + Voice ID (model defaults to `eleven_multilingual_v2`) → *Preview voice* → *Save voice*.
If the key is missing or ElevenLabs errors, speech silently falls back to the free **edge-tts** Hindi voices (`hi-IN-SwaraNeural` / `hi-IN-MadhurNeural`).

### Sarvam (Indic speech) and credits
Admin → Providers → Voice. Create a key at https://indus.sarvam.ai/key-management and paste it (or set `SARVAM_API_KEY`). Listening defaults to **Saaras v4**, speaking to **Bulbul v4 Flash** (voice selectable). Credits are limited, so:
* every call is **metered** (speech-to-text minutes, characters spoken) and shown in Admin → System as an estimated ₹ spend (GST included);
* a **budget guard** (default ₹85) switches to Groq Whisper / Edge voice automatically once the estimate reaches it, and also on any Sarvam error (402 out of credits, 429, network);
* only speech is uploaded (silence never is), replies are capped at ~320 characters, long replies are synthesized as parallel sentence chunks (same characters, ~half the latency), and voice mode closes itself after 60 s of silence.

### Groq free-tier limits (respected in code)
`services/groq_client.py` keeps a sliding 60 s window per model (≈85 % of 30 RPM / 8K TPM), waits briefly or returns a friendly *"Munshi is busy, try in N s"* (HTTP 429 → UI toast),
honours `retry-after`, and records Groq's `x-ratelimit-*` headers. Admin → System shows live usage. One command costs ~0.3–0.6K tokens; a notebook-photo scan ~2K.

---

## Testing

```bash
# Backend: 43 tests (auth/RBAC, tenant isolation, caps, approval gate, mock vs real, webhooks + capability URLs, Twilio trial parameter set, Sarvam with mocked HTTP, voice turns, OCR, admin, TTS…)
cd backend && .venv/bin/python -m pytest -q

# Live Groq smoke (a handful of real calls on a throwaway DB)
cd backend && .venv/bin/python scripts/smoke_groq.py

# Frontend e2e (Playwright boots the real API on :8011 with a fresh DB + Vite on :5174; fake Groq, fake mic = hindi.wav)
cd frontend && npx playwright install chromium && npx playwright test
E2E_LIVE=1 GROQ_API_KEY=… npx playwright test e2e/munshi.spec.ts   # same journey on real Groq

# README screenshots (real Groq planning, simulated actions, fresh sample shop) → docs/screenshots/
E2E_LIVE=1 GROQ_API_KEY=… npx playwright test e2e/docs-shots.spec.ts

# Production smoke + PWA checks (manifest, icons, service worker, Chrome installability, offline)
E2E_BASE_URL=https://munshi-web-navy.vercel.app npx playwright test e2e/smoke.spec.ts e2e/pwa.spec.ts
# PWA locally (service worker only registers in production builds):
npm run build && npx vite preview --port 4174 &   # needs the API on :8000
E2E_BASE_URL=http://127.0.0.1:4174 npx playwright test e2e/pwa.spec.ts
```
The e2e suite covers: route protection, signup → onboarding → dashboard → logout → login, the full plan → approve → results journey
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

## Install as an app (PWA)
Open the site in Chrome (Android or desktop) and use **Install app** in the sidebar / More menu / Settings, or Chrome's own install icon. On iPhone: Safari → Share → *Add to Home Screen*.
* `public/manifest.webmanifest` — standalone display, start URL `/app`, theme colour, any + maskable icons, home-screen shortcuts (*Ask Munshi*, *Udhaar ledger*) and install-dialog screenshots.
* `public/sw.js` — app-shell caching with offline fallback (`offline.html`). **`/api/*` is never cached**, so balances, plans and approvals always come from the network.
* Icons are rendered from the logo by `npm run icons` (`scripts/gen-icons.mjs`).
* The UI is mobile-first: bottom tab bar with safe-area insets, 16 px inputs (no iOS zoom-on-focus), route-level code splitting, tested at Pixel 7 size for horizontal overflow.

---

## Security notes
* Secrets live only in `backend/.env` (gitignored) and Vercel env. Twilio/ElevenLabs secrets are stored in the DB and **masked** in every API response.
* JWT bearer auth, bcrypt passwords, strict per-shop tenant isolation on every query, admin-only provider/settings endpoints.
* Twilio webhooks verify `X-Twilio-Signature` whenever mock mode is off (outbound-call webhooks additionally accept our own HMAC `?k=` capability URLs — see Twilio Voice). TTS URLs are HMAC-signed.
* "haan" detection is deliberately strict: only short utterances made *entirely* of yes/no words count, and only against a pending plan.

## Known limits / next steps
* **Loan offer is simulated** (no Paytm lending API) and labelled so. UPI pay links are real `upi://` deep links, but payment reconciliation is manual ("Mila") — a Paytm webhook would close the loop.
* Paytm Soundbox voice ingestion isn't wired (web, WhatsApp and phone are); the same `/api/agent/command` pipeline would serve it.
* Verified live so far: Sarvam STT/TTS, voice mode, outbound Hindi test call. Not yet verified live: the supplier-call negotiation loop, WhatsApp sends from a template (needs the sender's `HX…` SID), the evening-brief cron, ElevenLabs.
* The avatar is stylized vector art with audio-driven lip-sync; photoreal video would need a rendering service.
* Single-language UI copy is Hinglish; the planner and TTS are Hindi-first.
* Groq limits are per serverless instance (in-process); a shared limiter (Redis) would be needed at scale.

