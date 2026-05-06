from __future__ import annotations

import os
from pathlib import Path
from typing import Any, AsyncGenerator, Iterable

import aiosqlite


def _resolve_db_path() -> Path:
    backend_dir = Path(__file__).resolve().parent.parent
    sqlite_env = os.environ.get("AIR4_SQLITE_PATH") or "data/air4.db"
    p = Path(sqlite_env).expanduser()
    return p if p.is_absolute() else (backend_dir / p).resolve()


DB_PATH = _resolve_db_path()


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS uploads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT,
    account_iban TEXT,
    period_start TEXT,
    period_end TEXT,
    total_transactions INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    upload_id INTEGER,
    date TEXT,
    description TEXT,
    amount REAL,
    currency TEXT DEFAULT 'EUR',
    category TEXT DEFAULT 'other',
    category_confirmed BOOLEAN DEFAULT FALSE,
    account_iban TEXT,
    is_debit BOOLEAN,
    is_internal_transfer BOOLEAN DEFAULT FALSE,
    raw_description TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS insights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    upload_id INTEGER,
    insight_text TEXT,
    insight_type TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT,
    title TEXT,
    description TEXT,
    category TEXT,
    source TEXT DEFAULT 'manual',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_profile (
    id INTEGER PRIMARY KEY,
    name TEXT,
    context TEXT,
    city TEXT,
    profession TEXT,
    monthly_income REAL,
    goals TEXT,
    transport TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_facts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    value TEXT,
    source TEXT DEFAULT 'chat',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'active',
    started_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS project_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    note TEXT,
    source TEXT DEFAULT 'manual',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS hypotheses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    confirmed_at TEXT,
    rejected_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cross_sphere_insights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sphere1 TEXT,
    sphere2 TEXT,
    title TEXT,
    description TEXT,
    confidence TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    observation_type TEXT DEFAULT 'pattern',
    is_read BOOLEAN DEFAULT FALSE,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dilemmas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    options TEXT,
    analysis TEXT,
    recommendation TEXT,
    status TEXT DEFAULT 'open',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
"""


async def _ensure_user_profile_columns(db: aiosqlite.Connection) -> None:
    async with db.execute("PRAGMA table_info(user_profile)") as cur:
        rows = await cur.fetchall()
    colnames = {str(r[1]) for r in rows}
    alters: list[tuple[str, str]] = [
        ("city", "TEXT"),
        ("profession", "TEXT"),
        ("monthly_income", "REAL"),
        ("goals", "TEXT"),
        ("transport", "TEXT"),
    ]
    for col, typ in alters:
        if col not in colnames:
            await db.execute(f"ALTER TABLE user_profile ADD COLUMN {col} {typ}")


async def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript(SCHEMA_SQL)
        await _ensure_user_profile_columns(db)
        await db.execute(
            "INSERT OR IGNORE INTO user_profile (id, name, context) VALUES (1, NULL, NULL)"
        )
        await db.commit()


async def get_db() -> AsyncGenerator[aiosqlite.Connection, None]:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    try:
        yield db
    finally:
        await db.close()


async def fetch_one(
    db: aiosqlite.Connection, sql: str, params: Iterable[Any] = ()
) -> dict[str, Any] | None:
    async with db.execute(sql, tuple(params)) as cur:
        row = await cur.fetchone()
        return dict(row) if row is not None else None


async def fetch_all(
    db: aiosqlite.Connection, sql: str, params: Iterable[Any] = ()
) -> list[dict[str, Any]]:
    async with db.execute(sql, tuple(params)) as cur:
        rows = await cur.fetchall()
        return [dict(r) for r in rows]


async def execute(
    db: aiosqlite.Connection, sql: str, params: Iterable[Any] = ()
) -> int:
    cur = await db.execute(sql, tuple(params))
    await db.commit()
    return int(cur.lastrowid or 0)
