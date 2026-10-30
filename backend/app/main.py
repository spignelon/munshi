import json
import time
from contextlib import asynccontextmanager
from contextvars import ContextVar

_IMPORT_T0 = time.perf_counter()

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import models  # noqa: F401  (register tables)
from . import seed
from sqlalchemy import event, inspect

from .db import Base, SessionLocal, engine
from .routers import admin, agent, core, data, public, webhooks
from .services.groq_client import GroqBusy, GroqUnavailable
from .services.messaging import ProviderNotConfigured

_ready = False
_boot = {"import_ms": 0.0, "init_ms": 0.0, "served": 0}
# Per-request DB stats (query count / total DB time); contextvars propagate into FastAPI's worker threads.
_db_stats: ContextVar[dict | None] = ContextVar("db_stats", default=None)


@event.listens_for(engine, "before_cursor_execute")
def _q_start(conn, cursor, statement, parameters, context, executemany):
    conn.info["_t0"] = time.perf_counter()


@event.listens_for(engine, "after_cursor_execute")
def _q_end(conn, cursor, statement, parameters, context, executemany):
    st = _db_stats.get()
    if st is not None:
        st["n"] += 1
        st["ms"] += (time.perf_counter() - conn.info.pop("_t0", time.perf_counter())) * 1000


def init_db() -> None:
    global _ready
    if _ready:
        return
    t0 = time.perf_counter()
    if not set(Base.metadata.tables) <= set(inspect(engine).get_table_names()):  # one query; skip ~40 when already migrated
        Base.metadata.create_all(engine)
    with SessionLocal() as db:
        seed.bootstrap(db)
    _boot["init_ms"] = (time.perf_counter() - t0) * 1000
    _ready = True


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Munshi API", version="1.0.0", lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"], allow_methods=["*"], allow_headers=["*"],
                   allow_credentials=False)


@app.middleware("http")
async def ensure_ready_and_time(request: Request, call_next):
    """Lazy one-time init (serverless may skip lifespan) + per-request timing, surfaced as Server-Timing and a log line."""
    t0 = time.perf_counter()
    stats = {"n": 0, "ms": 0.0}
    token = _db_stats.set(stats)
    cold = not _ready
    try:
        init_db()
        response = await call_next(request)
    finally:
        _db_stats.reset(token)
    total = (time.perf_counter() - t0) * 1000
    timing = f'app;dur={total:.0f}, db;dur={stats["ms"]:.0f};desc="{stats["n"]} queries"'
    if cold:
        timing += f', init;dur={_boot["init_ms"]:.0f}, import;dur={_boot["import_ms"]:.0f}'
    response.headers["Server-Timing"] = timing
    _boot["served"] += 1
    print(json.dumps({"perf": request.url.path, "method": request.method, "status": response.status_code, "ms": round(total),
                      "db_ms": round(stats["ms"]), "db_queries": stats["n"], "cold": cold, "nth": _boot["served"],
                      **({"init_ms": round(_boot["init_ms"]), "import_ms": round(_boot["import_ms"])} if cold else {})}), flush=True)
    return response


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

_boot["import_ms"] = (time.perf_counter() - _IMPORT_T0) * 1000
