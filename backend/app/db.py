"""Database engine / session handling.

Local dev: SQLite file. Vercel: Turso (libSQL over Hrana) when configured,
otherwise an ephemeral SQLite file in /tmp.
"""
from urllib.parse import quote

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.pool import NullPool

from .config import ON_VERCEL, get_settings


class Base(DeclarativeBase):
    pass


def _build_engine():
    s = get_settings()
    if s.database_url:
        return create_engine(s.database_url), "custom"

    turso_ready = bool(s.turso_database_url and s.turso_auth_token)
    if turso_ready and (s.use_turso or ON_VERCEL):
        host = s.turso_database_url.replace("libsql://", "").rstrip("/")
        # NOTE: the dialect ignores ?authToken= in the URL; it must go via connect_args.
        url = f"sqlite+libsql://{quote(host)}/?secure=true"
        # NullPool: open a fresh connection per checkout. Serverless instances are frozen between requests, so a pooled
        # remote connection can be silently dead on thaw and hang the next request; sin1 -> Turso connects in a few ms.
        engine = create_engine(url, connect_args={"auth_token": s.turso_auth_token}, poolclass=NullPool)
        return engine, "turso"

    path = "/tmp/munshi.db" if ON_VERCEL else "./munshi.db"
    engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})
    return engine, ("ephemeral-sqlite" if ON_VERCEL else "sqlite")


engine, DB_KIND = _build_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
