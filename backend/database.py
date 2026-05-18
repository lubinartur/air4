from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Generator, Iterable

from dotenv import load_dotenv

load_dotenv()


def _resolve_db_path() -> Path:
    backend_dir = Path(__file__).resolve().parent
    raw = os.getenv("DATABASE_URL", "./data/air4.db")
    p = Path(raw).expanduser()
    return p if p.is_absolute() else (backend_dir / p).resolve()


DB_PATH = _resolve_db_path()

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS user_profile (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    name            TEXT,
    city            TEXT,
    profession      TEXT,
    monthly_income  REAL,
    goals           TEXT,
    transport       TEXT,
    context         TEXT,
    timezone        TEXT DEFAULT 'UTC',
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profile_single ON user_profile(id);

CREATE TABLE IF NOT EXISTS user_facts (
    id          INTEGER PRIMARY KEY,
    key         TEXT NOT NULL UNIQUE,
    value       TEXT NOT NULL,
    confidence  REAL DEFAULT 1.0,
    source      TEXT DEFAULT 'chat',
    evidence    TEXT,
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS embeddings (
    id              INTEGER PRIMARY KEY,
    content_type    TEXT NOT NULL,
    content_id      INTEGER,
    content_preview TEXT,
    vector          BLOB,
    model           TEXT,
    dimensions      INTEGER,
    created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
    id              INTEGER PRIMARY KEY,
    date            TEXT NOT NULL,
    timestamp       TEXT,
    title           TEXT NOT NULL,
    description     TEXT,
    original_text   TEXT,
    processed_text  TEXT,
    domain          TEXT NOT NULL,
    category        TEXT,
    importance      INTEGER DEFAULT 2,
    metadata        TEXT,
    embedding_id    INTEGER REFERENCES embeddings(id),
    source          TEXT DEFAULT 'chat',
    archived        INTEGER DEFAULT 0,
    archive_after   TEXT,
    summarized      INTEGER DEFAULT 0,
    created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS uploads (
    id                  INTEGER PRIMARY KEY,
    filename            TEXT NOT NULL,
    account_iban        TEXT,
    period_start        TEXT,
    period_end          TEXT,
    total_transactions  INTEGER,
    created_at          TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transactions (
    id                    INTEGER PRIMARY KEY,
    upload_id             INTEGER REFERENCES uploads(id),
    transaction_hash      TEXT UNIQUE,
    date                  TEXT NOT NULL,
    description           TEXT,
    amount                REAL NOT NULL,
    currency              TEXT DEFAULT 'EUR',
    category              TEXT,
    category_confirmed    INTEGER DEFAULT 0,
    account_iban          TEXT,
    is_debit              INTEGER DEFAULT 1,
    is_internal_transfer  INTEGER DEFAULT 0,
    raw_description       TEXT,
    created_at            TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS insights (
    id           INTEGER PRIMARY KEY,
    upload_id    INTEGER REFERENCES uploads(id),
    insight_text TEXT NOT NULL,
    insight_type TEXT,
    created_at   TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    status      TEXT DEFAULT 'active',
    priority    INTEGER DEFAULT 2,
    started_at  TEXT,
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_logs (
    id          INTEGER PRIMARY KEY,
    project_id  INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    note        TEXT NOT NULL,
    log_type    TEXT DEFAULT 'update',
    source      TEXT DEFAULT 'manual',
    created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS hypotheses (
    id              INTEGER PRIMARY KEY,
    text            TEXT NOT NULL,
    status          TEXT DEFAULT 'pending',
    confidence      REAL DEFAULT 0.5,
    evidence_count  INTEGER DEFAULT 1,
    evidence_refs   TEXT,
    domains         TEXT,
    confirmed_at    TEXT,
    rejected_at     TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cross_sphere_insights (
    id          INTEGER PRIMARY KEY,
    sphere1     TEXT NOT NULL,
    sphere2     TEXT NOT NULL,
    title       TEXT NOT NULL,
    description TEXT NOT NULL,
    confidence  REAL DEFAULT 0.5,
    evidence    TEXT,
    is_active   INTEGER DEFAULT 1,
    expires_at  TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS observations (
    id               INTEGER PRIMARY KEY,
    title            TEXT NOT NULL,
    body             TEXT NOT NULL,
    observation_type TEXT NOT NULL,
    confidence       REAL DEFAULT 0.5,
    evidence_count   INTEGER DEFAULT 1,
    evidence_refs    TEXT,
    domains_involved TEXT,
    triggered_by     TEXT DEFAULT 'rule_layer',
    is_hypothesis    INTEGER DEFAULT 1,
    is_read          INTEGER DEFAULT 0,
    expires_at       TEXT,
    created_at       TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dilemmas (
    id              INTEGER PRIMARY KEY,
    title           TEXT NOT NULL,
    description     TEXT,
    options         TEXT,
    analysis        TEXT,
    recommendation  TEXT,
    status          TEXT DEFAULT 'open',
    followup_due    TEXT,
    followup_done   INTEGER DEFAULT 0,
    followup_answer TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS interview_answers (
    id          INTEGER PRIMARY KEY,
    question    TEXT NOT NULL,
    answer      TEXT NOT NULL,
    domain      TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workouts (
    id              INTEGER PRIMARY KEY,
    date            TEXT NOT NULL,
    type            TEXT,
    duration        INTEGER,
    exercises       TEXT,
    energy_level    INTEGER,
    notes           TEXT,
    source          TEXT DEFAULT 'chat',
    event_id        INTEGER,
    created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS body_metrics (
    id          INTEGER PRIMARY KEY,
    date        TEXT NOT NULL,
    weight      REAL,
    height      REAL,
    body_fat    REAL,
    notes       TEXT,
    source      TEXT DEFAULT 'manual',
    created_at  TEXT DEFAULT (datetime('now'))
);
"""

INDEX_SQL = """
CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);
CREATE INDEX IF NOT EXISTS idx_events_domain ON events(domain);
CREATE INDEX IF NOT EXISTS idx_events_archived ON events(archived);
CREATE INDEX IF NOT EXISTS idx_events_importance ON events(importance);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category);
CREATE INDEX IF NOT EXISTS idx_transactions_hash ON transactions(transaction_hash);
CREATE INDEX IF NOT EXISTS idx_transactions_debit ON transactions(is_debit, is_internal_transfer);
CREATE INDEX IF NOT EXISTS idx_project_logs_project ON project_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_project_logs_date ON project_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_observations_read ON observations(is_read);
CREATE INDEX IF NOT EXISTS idx_observations_expires ON observations(expires_at);
CREATE INDEX IF NOT EXISTS idx_workouts_date ON workouts(date);
CREATE INDEX IF NOT EXISTS idx_body_metrics_date ON body_metrics(date);
"""


def _table_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    cur = conn.execute(f"PRAGMA table_info({table})")
    return {str(row[1]) for row in cur.fetchall()}


def _ensure_columns(
    conn: sqlite3.Connection, table: str, columns: list[tuple[str, str]]
) -> None:
    existing = _table_columns(conn, table)
    for name, ddl in columns:
        if name not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")


def _migrate_schema(conn: sqlite3.Connection) -> None:
    tables = {
        str(r[0])
        for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }

    if "events" in tables:
        _ensure_columns(
            conn,
            "events",
            [
                ("timestamp", "TEXT"),
                ("original_text", "TEXT"),
                ("processed_text", "TEXT"),
                ("domain", "TEXT DEFAULT 'life'"),
                ("importance", "INTEGER DEFAULT 2"),
                ("metadata", "TEXT"),
                ("embedding_id", "INTEGER"),
                ("archived", "INTEGER DEFAULT 0"),
                ("archive_after", "TEXT"),
                ("summarized", "INTEGER DEFAULT 0"),
            ],
        )
        conn.execute(
            "UPDATE events SET domain = 'life' WHERE domain IS NULL OR TRIM(domain) = ''"
        )

    if "transactions" in tables:
        _ensure_columns(
            conn,
            "transactions",
            [("transaction_hash", "TEXT")],
        )

    if "user_profile" in tables:
        _ensure_columns(conn, "user_profile", [("timezone", "TEXT DEFAULT 'UTC'")])

    if "user_facts" in tables:
        _ensure_columns(
            conn,
            "user_facts",
            [
                ("confidence", "REAL DEFAULT 1.0"),
                ("evidence", "TEXT"),
            ],
        )

    if "hypotheses" in tables:
        _ensure_columns(
            conn,
            "hypotheses",
            [
                ("confidence", "REAL DEFAULT 0.5"),
                ("evidence_count", "INTEGER DEFAULT 1"),
                ("evidence_refs", "TEXT"),
                ("domains", "TEXT"),
            ],
        )

    if "cross_sphere_insights" in tables:
        _ensure_columns(
            conn,
            "cross_sphere_insights",
            [
                ("evidence", "TEXT"),
                ("is_active", "INTEGER DEFAULT 1"),
                ("expires_at", "TEXT"),
            ],
        )

    if "observations" in tables:
        _ensure_columns(
            conn,
            "observations",
            [
                ("confidence", "REAL DEFAULT 0.5"),
                ("evidence_count", "INTEGER DEFAULT 1"),
                ("evidence_refs", "TEXT"),
                ("domains_involved", "TEXT"),
                ("triggered_by", "TEXT DEFAULT 'rule_layer'"),
                ("is_hypothesis", "INTEGER DEFAULT 1"),
                ("expires_at", "TEXT"),
            ],
        )

    if "projects" in tables:
        _ensure_columns(conn, "projects", [("priority", "INTEGER DEFAULT 2")])

    if "project_logs" in tables:
        _ensure_columns(
            conn,
            "project_logs",
            [("log_type", "TEXT DEFAULT 'update'")],
        )

    if "interview_answers" in tables:
        _ensure_columns(conn, "interview_answers", [("domain", "TEXT")])


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA cache_size=-64000")
        conn.executescript(SCHEMA_SQL)
        _migrate_schema(conn)
        conn.executescript(INDEX_SQL)
        conn.execute(
            "INSERT OR IGNORE INTO user_profile (id, name, context) VALUES (1, NULL, NULL)"
        )
        conn.commit()
    finally:
        conn.close()


@contextmanager
def get_db() -> Generator[sqlite3.Connection, None, None]:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
    finally:
        conn.close()


def fetch_one(
    conn: sqlite3.Connection, sql: str, params: Iterable[Any] = ()
) -> dict[str, Any] | None:
    cur = conn.execute(sql, tuple(params))
    row = cur.fetchone()
    return dict(row) if row is not None else None


def fetch_all(
    conn: sqlite3.Connection, sql: str, params: Iterable[Any] = ()
) -> list[dict[str, Any]]:
    cur = conn.execute(sql, tuple(params))
    return [dict(r) for r in cur.fetchall()]


def execute(
    conn: sqlite3.Connection, sql: str, params: Iterable[Any] = ()
) -> int:
    cur = conn.execute(sql, tuple(params))
    conn.commit()
    return int(cur.lastrowid or 0)
