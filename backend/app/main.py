from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import models  # noqa: F401  (register tables)
from . import seed
from .db import Base, SessionLocal, engine
from .routers import admin, agent, core, data, public, webhooks
from .services.groq_client import GroqBusy, GroqUnavailable
from .services.messaging import ProviderNotConfigured

_ready = False


def init_db() -> None:
    global _ready
    if _ready:
        return
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        seed.bootstrap(db)
    _ready = True


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Munshi API", version="1.0.0", lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"], allow_methods=["*"], allow_headers=["*"],
                   allow_credentials=False)


@app.middleware("http")
async def ensure_ready(request: Request, call_next):
    init_db()  # also covers serverless runtimes that skip lifespan events
    return await call_next(request)


@app.exception_handler(GroqBusy)
async def groq_busy(_: Request, exc: GroqBusy):
    return JSONResponse({"detail": str(exc), "retry_after": exc.retry_after}, status_code=429, headers={"Retry-After": str(exc.retry_after)})


@app.exception_handler(GroqUnavailable)
async def groq_unavailable(_: Request, exc: GroqUnavailable):
    return JSONResponse({"detail": str(exc)}, status_code=503)


@app.exception_handler(ProviderNotConfigured)
async def not_configured(_: Request, exc: ProviderNotConfigured):
    return JSONResponse({"detail": str(exc)}, status_code=400)


for r in (core.router, data.router, agent.router, admin.router, public.router, webhooks.router):
    app.include_router(r)
