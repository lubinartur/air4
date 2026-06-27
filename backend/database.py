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
    air4_mode       TEXT DEFAULT 'normal',
    observer_enabled INTEGER DEFAULT 1,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profile_single ON user_profile(id);

-- Small key/value store for one-time migration flags and similar runtime
-- metadata. Use `get_meta` / `set_meta` helpers instead of touching this
-- table directly.
CREATE TABLE IF NOT EXISTS _app_meta (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
);

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
    -- JSON array of goal identifiers (`user_facts.key` for chat-derived
    -- goals, `profile:<idx>` for goals saved directly on user_profile).
    -- Plain TEXT so unknown / orphaned keys are still preserved on
    -- read without forcing a foreign-key constraint that can break
    -- upgrades when the underlying fact row is renamed.
    goal_keys   TEXT,
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_logs (
    id                INTEGER PRIMARY KEY,
    project_id        INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    note              TEXT NOT NULL,
    log_type          TEXT DEFAULT 'update',
    duration_minutes  INTEGER,
    source            TEXT DEFAULT 'manual',
    created_at        TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_todos (
    id          INTEGER PRIMARY KEY,
    project_id  INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    text        TEXT NOT NULL,
    done        INTEGER DEFAULT 0,
    done_at     TEXT,
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
    -- Decision Memory Layer (see _migrate_schema for existing-DB upgrade):
    -- `decision_made` is the concrete choice the user landed on,
    -- `outcome` is what actually happened ~2 weeks later,
    -- `tags` is a JSON array of free-form domain tags (finance, health, ...).
    decision_made   TEXT,
    outcome         TEXT,
    tags            TEXT,
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

CREATE TABLE IF NOT EXISTS health_checkups (
    id              INTEGER PRIMARY KEY,
    date            TEXT NOT NULL,
    marker_name     TEXT NOT NULL,
    value           REAL NOT NULL,
    unit            TEXT,
    reference_min   REAL,
    reference_max   REAL,
    status          TEXT,
    source          TEXT DEFAULT 'manual',
    created_at      TEXT DEFAULT (datetime('now')),
    UNIQUE(date, marker_name)
);

CREATE TABLE IF NOT EXISTS subscriptions (
    id           INTEGER PRIMARY KEY,
    name         TEXT NOT NULL,
    amount       REAL,
    currency     TEXT DEFAULT 'EUR',
    billing_day  INTEGER,
    category     TEXT DEFAULT 'other',
    is_active    INTEGER DEFAULT 1,
    source       TEXT DEFAULT 'manual',
    created_at   TEXT DEFAULT (datetime('now')),
    updated_at   TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS obligations (
    id                INTEGER PRIMARY KEY,
    name              TEXT NOT NULL,
    total_amount      REAL,
    remaining_amount  REAL,
    monthly_payment   REAL,
    interest_rate     REAL,
    due_date          TEXT,
    category          TEXT DEFAULT 'loan',
    is_active         INTEGER DEFAULT 1,
    source            TEXT DEFAULT 'manual',
    created_at        TEXT DEFAULT (datetime('now')),
    updated_at        TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS income_sources (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    keywords    TEXT NOT NULL,                -- JSON array of substrings (case-insensitive)
    category    TEXT DEFAULT 'salary',        -- 'salary' | 'freelance' | 'rental' | 'other'
    is_active   INTEGER DEFAULT 1,
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id              INTEGER PRIMARY KEY,
    role            TEXT NOT NULL,                 -- 'user' | 'assistant'
    content         TEXT NOT NULL,
    page            TEXT,
    -- Optional attachment for chat input: base64-encoded image or PDF.
    -- Stored inline so the chat history reload can re-render the bubble
    -- with its thumbnail/icon. Only ever populated on user-role rows.
    attachment_data TEXT,
    attachment_type TEXT,
    attachment_name TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS spaces (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    icon        TEXT DEFAULT '✦',
    created_at  TEXT DEFAULT (datetime('now')),
    last_active TEXT
);

CREATE TABLE IF NOT EXISTS identity_model (
    id              INTEGER PRIMARY KEY,
    category        TEXT NOT NULL,
    insight         TEXT NOT NULL,
    confidence      REAL DEFAULT 0.5,
    evidence_count  INTEGER DEFAULT 1,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS followups (
    id              INTEGER PRIMARY KEY,
    event_text      TEXT NOT NULL,
    followup_date   TEXT NOT NULL,
    question        TEXT NOT NULL,
    status          TEXT DEFAULT 'pending',
    created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS open_loops (
    id          INTEGER PRIMARY KEY,
    topic       TEXT NOT NULL,
    domain      TEXT,
    priority    TEXT DEFAULT 'medium',
    status      TEXT DEFAULT 'open',
    created_at  TEXT DEFAULT (datetime('now')),
    resolved_at TEXT
);

-- Categorization memory. Every confirmed user correction on a
-- transaction's category lands here as a merchant pattern → category
-- rule, so subsequent uploads auto-apply the same mapping instead of
-- forcing the user to re-categorize.
--
-- `pattern` is the normalized merchant fragment (lowercase, digits +
-- transaction-code prefixes stripped). `match_type` describes how
-- `pattern` is tested against incoming descriptions; default is
-- `contains` which fits Estonian Swedbank descriptions like
-- "POS RIMI TARTU 5168..." (pattern "rimi tartu" matches via substring).
-- `confidence` is reserved for future fuzzy rules — manual user
-- confirmations always seed at 1.0. `times_applied` is bumped each
-- time `apply_category_rules` lands a hit so we can later expose the
-- most-effective rules in the UI.
CREATE TABLE IF NOT EXISTS observer_events (
    id              INTEGER PRIMARY KEY,
    app_name        TEXT NOT NULL,
    window_title    TEXT,
    duration_seconds INTEGER NOT NULL,
    domain          TEXT,
    project_hint    TEXT,
    observed_at     TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS category_rules (
    id             INTEGER PRIMARY KEY,
    pattern        TEXT NOT NULL,
    category       TEXT NOT NULL,
    match_type     TEXT DEFAULT 'contains',   -- 'exact' | 'contains' | 'starts_with'
    confidence     REAL DEFAULT 1.0,
    times_applied  INTEGER DEFAULT 0,
    source         TEXT DEFAULT 'user',       -- 'user' | 'system'
    created_at     TEXT DEFAULT (datetime('now')),
    updated_at     TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS discovery_gaps (
    id              INTEGER PRIMARY KEY,
    category        TEXT NOT NULL UNIQUE,
    question_hint   TEXT NOT NULL,
    priority        INTEGER DEFAULT 2,
    status          TEXT DEFAULT 'open',
    learned_value   TEXT,
    last_asked      TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
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
CREATE INDEX IF NOT EXISTS idx_category_rules_pattern ON category_rules(pattern);
CREATE INDEX IF NOT EXISTS idx_project_logs_project ON project_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_project_logs_date ON project_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_project_todos_project ON project_todos(project_id);
CREATE INDEX IF NOT EXISTS idx_project_todos_done ON project_todos(done);
CREATE INDEX IF NOT EXISTS idx_observations_read ON observations(is_read);
CREATE INDEX IF NOT EXISTS idx_observations_expires ON observations(expires_at);
CREATE INDEX IF NOT EXISTS idx_workouts_date ON workouts(date);
CREATE INDEX IF NOT EXISTS idx_body_metrics_date ON body_metrics(date);
CREATE INDEX IF NOT EXISTS idx_health_checkups_date ON health_checkups(date);
CREATE INDEX IF NOT EXISTS idx_health_checkups_marker ON health_checkups(marker_name);
CREATE INDEX IF NOT EXISTS idx_subscriptions_active ON subscriptions(is_active);
CREATE INDEX IF NOT EXISTS idx_obligations_active ON obligations(is_active);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_spaces_last_active ON spaces(last_active);
CREATE INDEX IF NOT EXISTS idx_identity_model_updated ON identity_model(updated_at);
CREATE INDEX IF NOT EXISTS idx_followups_date_status ON followups(followup_date, status);
CREATE INDEX IF NOT EXISTS idx_open_loops_status ON open_loops(status);
-- Audit follow-ups: support feed/timeline/summary hot paths.
-- transactions(upload_id, account_iban) — joins with `uploads`, per-IBAN
-- filtering in summary_loader and the cycles router. events/observations
-- ordered by created_at for /api/feed. subscriptions/user_facts ordered
-- by updated_at for the most-recent-change lookups in feed + recurring.
CREATE INDEX IF NOT EXISTS idx_transactions_upload_id ON transactions(upload_id);
CREATE INDEX IF NOT EXISTS idx_transactions_account_iban ON transactions(account_iban);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_observations_created_at ON observations(created_at);
CREATE INDEX IF NOT EXISTS idx_subscriptions_updated_at ON subscriptions(updated_at);
CREATE INDEX IF NOT EXISTS idx_user_facts_updated_at ON user_facts(updated_at);
CREATE INDEX IF NOT EXISTS idx_observer_date ON observer_events(observed_at);
CREATE INDEX IF NOT EXISTS idx_discovery_gaps_status ON discovery_gaps(status);
CREATE INDEX IF NOT EXISTS idx_discovery_gaps_category ON discovery_gaps(category);
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
        # AIR4 engagement mode (quiet | normal | active | jarvis). Gated
        # by an _app_meta flag per spec so the ALTER + backfill run at
        # most once; `_ensure_columns` is also inherently idempotent on
        # its own, so re-running this is always safe.
        if get_meta(conn, "air4_mode_migration_done") != "1":
            _ensure_columns(
                conn, "user_profile", [("air4_mode", "TEXT DEFAULT 'normal'")]
            )
            conn.execute(
                "UPDATE user_profile SET air4_mode = 'normal' "
                "WHERE air4_mode IS NULL OR TRIM(air4_mode) = ''"
            )
            set_meta(conn, "air4_mode_migration_done", "1")
        _ensure_columns(
            conn, "user_profile", [("observer_enabled", "INTEGER DEFAULT 1")]
        )

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
        _ensure_columns(
            conn,
            "projects",
            [
                ("priority", "INTEGER DEFAULT 2"),
                # Goal links — see SCHEMA_SQL comment for the
                # identifier convention. NULL means "no goals linked",
                # an empty JSON array `[]` means "explicitly unlinked".
                ("goal_keys", "TEXT"),
            ],
        )

    if "project_logs" in tables:
        _ensure_columns(
            conn,
            "project_logs",
            [
                ("log_type", "TEXT DEFAULT 'update'"),
                ("duration_minutes", "INTEGER"),
            ],
        )

    if "interview_answers" in tables:
        _ensure_columns(conn, "interview_answers", [("domain", "TEXT")])

    if "chat_messages" in tables:
        # Attachment columns added for image/PDF uploads in the chat
        # input. Pre-existing rows stay attachment-less (NULL), which
        # the API serializes as `attachment: null`.
        _ensure_columns(
            conn,
            "chat_messages",
            [
                ("attachment_data", "TEXT"),
                ("attachment_type", "TEXT"),
                ("attachment_name", "TEXT"),
            ],
        )

    if "subscriptions" in tables:
        _ensure_columns(
            conn,
            "subscriptions",
            [
                ("amount", "REAL"),
                ("currency", "TEXT DEFAULT 'EUR'"),
                ("billing_day", "INTEGER"),
                ("category", "TEXT DEFAULT 'other'"),
                ("is_active", "INTEGER DEFAULT 1"),
                ("source", "TEXT DEFAULT 'manual'"),
                ("updated_at", "TEXT DEFAULT (datetime('now'))"),
            ],
        )

    if "obligations" in tables:
        _ensure_columns(
            conn,
            "obligations",
            [
                ("total_amount", "REAL"),
                ("remaining_amount", "REAL"),
                ("monthly_payment", "REAL"),
                ("interest_rate", "REAL"),
                ("due_date", "TEXT"),
                ("category", "TEXT DEFAULT 'loan'"),
                ("is_active", "INTEGER DEFAULT 1"),
                ("source", "TEXT DEFAULT 'manual'"),
                ("updated_at", "TEXT DEFAULT (datetime('now'))"),
            ],
        )

    # Decision Memory Layer — extends `dilemmas` with what was decided,
    # what actually happened later, and free-form tags for slicing the
    # advisor's questions by domain. `tags` is JSON (matches the
    # convention used by `hypotheses.domains` / `observations.domains_involved`).
    if "dilemmas" in tables:
        _ensure_columns(
            conn,
            "dilemmas",
            [
                ("decision_made", "TEXT"),
                ("outcome", "TEXT"),
                ("tags", "TEXT"),
            ],
        )


_DEFAULT_INCOME_SOURCES: tuple[tuple[str, str, str], ...] = (
    # (name, JSON keywords, category)
    ("Placet Group salary", '["töötasu", "preemia"]', "salary"),
)


def _seed_income_sources(conn: sqlite3.Connection) -> None:
    """Insert default income sources only on first run.

    Skipped entirely once the table has any rows (active or inactive),
    so the user can edit/delete defaults without them being restored.
    """
    row = conn.execute("SELECT COUNT(*) FROM income_sources").fetchone()
    if row and int(row[0]) > 0:
        return
    for name, keywords, category in _DEFAULT_INCOME_SOURCES:
        conn.execute(
            """
            INSERT INTO income_sources (name, keywords, category, is_active)
            VALUES (?, ?, ?, 1)
            """,
            (name, keywords, category),
        )


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    try:
        _apply_runtime_pragmas(conn)
        conn.executescript(SCHEMA_SQL)
        _migrate_schema(conn)
        conn.executescript(INDEX_SQL)
        conn.execute(
            "INSERT OR IGNORE INTO user_profile (id, name, context) VALUES (1, NULL, NULL)"
        )
        _seed_income_sources(conn)
        from services.discovery import seed_discovery_gaps

        seed_discovery_gaps(conn)
        conn.commit()
    finally:
        conn.close()


def _apply_runtime_pragmas(conn: sqlite3.Connection) -> None:
    """Tuning that must be re-applied on each new connection.

    `journal_mode=WAL` is persisted on the DB file once set, but SQLite
    treats `synchronous`, `foreign_keys`, and `cache_size` as
    per-connection. `init_db()` opens its own connection and then closes
    it, so without re-applying them here every request reverts to
    defaults (`synchronous=FULL`, 2 MB cache). Confirmed via PRAGMA dump.
    """
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA cache_size=-64000")


@contextmanager
def get_db() -> Generator[sqlite3.Connection, None, None]:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    _apply_runtime_pragmas(conn)
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


def get_meta(conn: sqlite3.Connection, key: str) -> str | None:
    """Read a value from the `_app_meta` key/value store. Returns ``None``
    when the key isn't set. Used for one-time migration flags."""
    row = conn.execute(
        "SELECT value FROM _app_meta WHERE key = ?", (key,)
    ).fetchone()
    return None if row is None else (None if row[0] is None else str(row[0]))


def set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    """Upsert a value into the `_app_meta` key/value store and commit."""
    conn.execute(
        """
        INSERT INTO _app_meta(key, value, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = datetime('now')
        """,
        (key, value),
    )
    conn.commit()
