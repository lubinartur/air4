"""SQLite database session and engine (MVP). Vector store stays behind JSON for future Chroma/pgvector."""

import os
from collections.abc import Generator
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, declarative_base, sessionmaker

_BACKEND_DIR = Path(__file__).resolve().parent.parent
_sqlite_env = os.environ.get("AIR4_SQLITE_PATH")
if _sqlite_env:
    _p = Path(_sqlite_env).expanduser()
    _DB_PATH = _p if _p.is_absolute() else (_BACKEND_DIR / _p).resolve()
else:
    _DB_PATH = _BACKEND_DIR / "air4.db"
DATABASE_URL = f"sqlite:///{_DB_PATH}"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    echo=False,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
