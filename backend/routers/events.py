"""Unified life-event feed for the Memory page.

`GET /api/events` aggregates from three sources so the Memory page's
domain filters reflect everything the user has actually generated:

  1. `events`         — chat-extracted life events (existing source of
                        `health`, `life`, `personal` domains).
  2. `transactions`   — bank activity, synthesized as `domain="finance"`
                        rows. Excludes internal transfers, balance/
                        turnover service rows, and tiny noise
                        transactions (< €20).
  3. `project_logs`   — manual + session logs joined to `projects.name`,
                        synthesized as `domain="projects"` rows. Skips
                        `session_start` markers (open-session pings
                        without content).

Synthetic IDs prevent React key collisions across the three sources
(`Memory.tsx` keys cards by `event.id`):

  events       → real id (always small positive)
  transactions → 1_000_000_000 + id
  project_logs → 2_000_000_000 + id

The returned `total` is the sum of eligible rows across all three
sources (after the same filters used for the list), so the "X из Y"
footer in Memory.tsx is meaningful.
"""

from __future__ import annotations

from fastapi import APIRouter

from database import fetch_all, fetch_one, get_db
from routers.transactions import _EXCLUDE_SERVICE_ROWS
from schemas import EventOut, EventsListOut

router = APIRouter()

# Per-source caps. Total returned rows ≤ sum of these caps; the frontend
# already handles "showing N of total" so callers can paginate later
# without breaking the shape.
_EVENTS_LIMIT = 50
_TRANSACTIONS_LIMIT = 20
_PROJECT_LOGS_LIMIT = 20

# ID offsets keep React keys unique across heterogeneous sources.
_TXN_ID_OFFSET = 1_000_000_000
_LOG_ID_OFFSET = 2_000_000_000

# Floor for "significant" transactions — below this, bank fees / coffees
# bury everything interesting on the Memory page. Matches the threshold
# discussed in the spec and is easy to tune in one place.
_TXN_MIN_AMOUNT = 20.0

# Project-log type labels surfaced as the synthesized event's category.
# `session_start` is intentionally absent — it's a marker, not content.
_LOG_TYPE_LABEL: dict[str, str] = {
    "session": "СЕССИЯ",
    "milestone": "MILESTONE",
    "update": "ОБНОВЛЕНИЕ",
}


def _format_amount(amount: float, currency: str) -> str:
    """Compact money string for event titles.

    Always shows two decimals; the Memory card is narrow, so longer
    formats (thousands separators, no decimals) would either wrap or
    look inconsistent next to bank fees that genuinely use cents.
    """
    symbol = "€" if (currency or "").upper() == "EUR" else f"{currency} "
    return f"{symbol}{amount:.2f}"


def _transactions_as_events(conn) -> tuple[list[EventOut], int]:
    """Materialize recent significant transactions as finance events.

    Title pattern: "Spent €X.XX · {merchant}" for debits,
    "Received €X.XX · {merchant}" for credits. `description` is the
    cleaned merchant text already; `raw_description` is the original
    bank narration and only shown when description is empty.
    """
    where = (
        "COALESCE(is_internal_transfer, 0) = 0"
        f" AND {_EXCLUDE_SERVICE_ROWS}"
        " AND amount > ?"
    )
    params: tuple = (_TXN_MIN_AMOUNT,)

    total_row = fetch_one(
        conn,
        f"SELECT COUNT(*) AS n FROM transactions WHERE {where}",
        params,
    )
    total = int(total_row["n"]) if total_row else 0

    rows = fetch_all(
        conn,
        f"""
        SELECT id, date, description, raw_description, amount, currency,
               category, is_debit, created_at
        FROM transactions
        WHERE {where}
        ORDER BY date DESC, id DESC
        LIMIT ?
        """,
        params + (_TRANSACTIONS_LIMIT,),
    )

    out: list[EventOut] = []
    for row in rows:
        try:
            amount = float(row.get("amount") or 0.0)
        except (TypeError, ValueError):
            amount = 0.0
        currency = str(row.get("currency") or "EUR")
        merchant = (
            str(row.get("description") or "").strip()
            or str(row.get("raw_description") or "").strip()
            or "Transaction"
        )
        is_debit = bool(row.get("is_debit"))
        verb = "Spent" if is_debit else "Received"
        title = f"{verb} {_format_amount(amount, currency)} · {merchant}"
        category = str(row.get("category") or "").strip() or (
            "expense" if is_debit else "income"
        )
        out.append(
            EventOut(
                id=_TXN_ID_OFFSET + int(row["id"]),
                date=str(row.get("date") or ""),
                title=title,
                description=None,
                domain="finance",
                category=category,
                importance=2,
                created_at=row.get("created_at"),
            )
        )
    return out, total


def _project_logs_as_events(conn) -> tuple[list[EventOut], int]:
    """Materialize recent project_logs as projects events.

    Each row pulls `projects.name` via LEFT JOIN so cards can read like
    "Personal site · СЕССИЯ" with the note as the description. Sessions
    optionally include duration in the title for at-a-glance scanning.
    """
    where = "LOWER(COALESCE(pl.log_type, '')) <> 'session_start'"

    total_row = fetch_one(
        conn,
        f"SELECT COUNT(*) AS n FROM project_logs pl WHERE {where}",
    )
    total = int(total_row["n"]) if total_row else 0

    rows = fetch_all(
        conn,
        f"""
        SELECT pl.id, pl.note, pl.log_type, pl.duration_minutes,
               pl.created_at,
               p.name AS project_name
        FROM project_logs pl
        LEFT JOIN projects p ON p.id = pl.project_id
        WHERE {where}
        ORDER BY datetime(pl.created_at) DESC, pl.id DESC
        LIMIT ?
        """,
        (_PROJECT_LOGS_LIMIT,),
    )

    out: list[EventOut] = []
    for row in rows:
        project = str(row.get("project_name") or "Проект").strip() or "Проект"
        raw_type = str(row.get("log_type") or "update").strip().lower()
        type_label = _LOG_TYPE_LABEL.get(raw_type, raw_type.upper() or "ОБНОВЛЕНИЕ")
        # Duration is only meaningful on session rows; surface it in
        # the title so users see total focused time without expanding.
        duration = row.get("duration_minutes")
        if raw_type == "session" and isinstance(duration, (int, float)) and duration:
            title = f"{project} · {type_label} · {int(duration)} мин"
        else:
            title = f"{project} · {type_label}"

        created_at = str(row.get("created_at") or "")
        # `created_at` is "YYYY-MM-DD HH:MM:SS"; Memory groups by date,
        # so trim to just the date component.
        date_part = created_at[:10] if len(created_at) >= 10 else created_at

        note = str(row.get("note") or "").strip()
        out.append(
            EventOut(
                id=_LOG_ID_OFFSET + int(row["id"]),
                date=date_part,
                title=title,
                description=note or None,
                domain="projects",
                category=raw_type or None,
                importance=2,
                created_at=created_at or None,
            )
        )
    return out, total


def _events_table_as_events(conn) -> tuple[list[EventOut], int]:
    """Read the existing `events` table — unchanged from prior behavior."""
    total_row = fetch_one(
        conn,
        "SELECT COUNT(*) AS n FROM events WHERE COALESCE(archived, 0) = 0",
    )
    total = int(total_row["n"]) if total_row else 0

    rows = fetch_all(
        conn,
        """
        SELECT id, date, title, description, domain, category, importance,
               created_at
        FROM events
        WHERE COALESCE(archived, 0) = 0
        ORDER BY date DESC, datetime(created_at) DESC, id DESC
        LIMIT ?
        """,
        (_EVENTS_LIMIT,),
    )
    return [EventOut(**r) for r in rows], total


def _sort_key(ev: EventOut) -> tuple[str, str, int]:
    """Stable sort: date DESC, then created_at DESC, then id DESC.

    Returns a tuple suitable for `sorted(..., reverse=True)` so newer
    items float to the top regardless of source. Missing timestamps
    sort to the bottom by using empty strings as the floor.
    """
    return (ev.date or "", ev.created_at or "", ev.id)


@router.get("/events", response_model=EventsListOut)
def list_events() -> EventsListOut:
    with get_db() as conn:
        events_rows, events_total = _events_table_as_events(conn)
        txn_rows, txn_total = _transactions_as_events(conn)
        log_rows, log_total = _project_logs_as_events(conn)

    merged = events_rows + txn_rows + log_rows
    merged.sort(key=_sort_key, reverse=True)

    return EventsListOut(
        events=merged,
        total=events_total + txn_total + log_total,
    )
