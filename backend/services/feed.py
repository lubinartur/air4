"""Cross-sphere activity feed.

Unions recent rows from `transactions`, `uploads`, `project_logs`,
`events`, `observations`, and parses recurring-update footers out of
`chat_messages` to surface subscription corrections. Each source is
normalised into a small `FeedItem`-shaped dict and the combined list is
sorted by `created_at` descending.

The aggregator deliberately reads from the live source tables instead of
maintaining a denormalised activity log — there's no write-side coupling
to keep in sync, and the cost of a few small `SELECT … LIMIT N` queries
on indexed columns is negligible.
"""

from __future__ import annotations

import logging
import re
import sqlite3
from typing import Any, Iterable

from database import fetch_all

logger = logging.getLogger("feed")

# Per-source caps. We over-fetch so the union sort still picks the most
# recent items globally; the final caller truncates to `limit`.
_PER_SOURCE_LIMIT = 30

# Matches the markdown footer subscription_updater appends to assistant
# replies. Captures the name and the new amount.
_RECURRING_FOOTER_RE = re.compile(
    r"_Обновлено:\s+(?P<name>[^→€_]+?)\s+(?:€(?P<old>[\d.,]+)\s+)?→\s+€(?P<new>[\d.,]+)_",
    re.IGNORECASE,
)
_DELETE_FOOTER_RE = re.compile(r"_Удалено:\s+(?P<name>[^_]+?)_", re.IGNORECASE)


def _parse_float(raw: str | None) -> float | None:
    if raw is None:
        return None
    try:
        return float(raw.replace(",", "."))
    except (TypeError, ValueError):
        return None


def _now_for_sort(value: Any) -> str:
    """Coerce arbitrary timestamp values to a string usable as a sort key.
    SQLite stores datetimes as TEXT in ISO-ish form, so lexicographic sort
    matches chronological sort for valid values.
    """
    if value is None:
        return ""
    return str(value)


def _transactions_items(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = fetch_all(
        conn,
        f"""
        SELECT id, date, description, amount, currency, category, is_debit,
               is_internal_transfer, created_at
        FROM transactions
        WHERE COALESCE(is_internal_transfer, 0) = 0
        ORDER BY datetime(date) DESC, id DESC
        LIMIT {_PER_SOURCE_LIMIT}
        """,
    )
    out: list[dict[str, Any]] = []
    for row in rows:
        desc = str(row.get("description") or "").strip() or "Transaction"
        amount = row.get("amount")
        is_debit = bool(row.get("is_debit"))
        try:
            amt = float(amount) if amount is not None else 0.0
        except (TypeError, ValueError):
            amt = 0.0
        verb = "Spent" if is_debit else "Received"
        # Income side typically reads "Received salary €3,835"; debits read
        # "Spent €45 at <merchant>". Use the description for both but switch
        # the preposition.
        title = (
            f"{verb} €{amt:.2f} at {desc}" if is_debit else f"{verb} €{amt:.2f}"
        )
        subtitle = desc if not is_debit else None
        out.append({
            "type": "transaction",
            "title": title,
            "subtitle": subtitle,
            "amount": amt,
            "currency": str(row.get("currency") or "EUR"),
            "icon": "credit-card" if is_debit else "trending-up",
            "created_at": _now_for_sort(row.get("date") or row.get("created_at")),
        })
    return out


def _uploads_items(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = fetch_all(
        conn,
        f"""
        SELECT id, filename, period_start, period_end, total_transactions,
               created_at
        FROM uploads
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT {_PER_SOURCE_LIMIT}
        """,
    )
    out: list[dict[str, Any]] = []
    for row in rows:
        period = ""
        if row.get("period_start") and row.get("period_end"):
            period = f"{row['period_start']} – {row['period_end']}"
        elif row.get("period_start"):
            period = str(row["period_start"])
        total = row.get("total_transactions")
        subtitle = (
            f"{total} transactions" if isinstance(total, int) and total else None
        )
        out.append({
            "type": "upload",
            "title": (
                f"Uploaded statement {period}".strip()
                if period
                else f"Uploaded {row.get('filename') or 'statement'}"
            ),
            "subtitle": subtitle,
            "amount": None,
            "currency": None,
            "icon": "upload",
            "created_at": _now_for_sort(row.get("created_at")),
        })
    return out


def _project_logs_items(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = fetch_all(
        conn,
        f"""
        SELECT pl.id, pl.note, pl.log_type, pl.duration_minutes, pl.created_at,
               p.name AS project_name
        FROM project_logs pl
        LEFT JOIN projects p ON p.id = pl.project_id
        ORDER BY datetime(pl.created_at) DESC, pl.id DESC
        LIMIT {_PER_SOURCE_LIMIT}
        """,
    )
    out: list[dict[str, Any]] = []
    for row in rows:
        project = str(row.get("project_name") or "project").strip() or "project"
        log_type = str(row.get("log_type") or "").strip().lower()
        duration = row.get("duration_minutes")
        if log_type == "session" or duration:
            mins = int(duration) if isinstance(duration, (int, float)) else 0
            title = (
                f"Logged session on {project}"
                if not mins
                else f"Logged {mins}-min session on {project}"
            )
        else:
            title = f"Logged update on {project}"
        note = str(row.get("note") or "").strip()
        out.append({
            "type": "project_log",
            "title": title,
            "subtitle": note[:120] if note else None,
            "amount": None,
            "currency": None,
            "icon": "briefcase",
            "created_at": _now_for_sort(row.get("created_at")),
        })
    return out


def _events_items(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = fetch_all(
        conn,
        f"""
        SELECT id, title, description, domain, category, created_at, date
        FROM events
        WHERE COALESCE(archived, 0) = 0
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT {_PER_SOURCE_LIMIT}
        """,
    )
    out: list[dict[str, Any]] = []
    for row in rows:
        title = str(row.get("title") or "").strip() or "Event"
        domain = str(row.get("domain") or "life").strip().lower()
        icon = {
            "health": "activity",
            "finance": "credit-card",
            "work": "briefcase",
            "life": "calendar",
        }.get(domain, "calendar")
        desc = str(row.get("description") or "").strip()
        out.append({
            "type": "event",
            "title": f"Added event: {title}",
            "subtitle": desc[:120] if desc else None,
            "amount": None,
            "currency": None,
            "icon": icon,
            "created_at": _now_for_sort(row.get("created_at") or row.get("date")),
        })
    return out


def _observations_items(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = fetch_all(
        conn,
        f"""
        SELECT id, title, body, observation_type, created_at
        FROM observations
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT {_PER_SOURCE_LIMIT}
        """,
    )
    out: list[dict[str, Any]] = []
    for row in rows:
        title = str(row.get("title") or "").strip() or "Observation"
        body = str(row.get("body") or "").strip()
        out.append({
            "type": "observation",
            "title": f"AIR4 noticed: {title}",
            "subtitle": body[:140] if body else None,
            "amount": None,
            "currency": None,
            "icon": "sparkles",
            "created_at": _now_for_sort(row.get("created_at")),
        })
    return out


def _subscription_change_items(
    conn: sqlite3.Connection,
) -> list[dict[str, Any]]:
    """Parse recurring-update footers out of recent assistant messages.

    The chat router appends `_Обновлено: X €old → €new_` / `_Удалено: X_`
    to assistant replies whenever subscription_updater fires; reading those
    back gives us a structured changelog without a dedicated log table.
    """
    rows = fetch_all(
        conn,
        f"""
        SELECT id, content, created_at
        FROM chat_messages
        WHERE role = 'assistant'
        ORDER BY id DESC
        LIMIT {_PER_SOURCE_LIMIT}
        """,
    )
    out: list[dict[str, Any]] = []
    for row in rows:
        content = str(row.get("content") or "")
        created = _now_for_sort(row.get("created_at"))
        if not content or not created:
            continue
        for match in _RECURRING_FOOTER_RE.finditer(content):
            name = match.group("name").strip()
            new_val = _parse_float(match.group("new"))
            old_val = _parse_float(match.group("old"))
            if new_val is None:
                continue
            if old_val is not None:
                title = f"Updated {name} €{old_val:.2f} → €{new_val:.2f}"
            else:
                title = f"Updated {name} → €{new_val:.2f}"
            out.append({
                "type": "subscription",
                "title": title,
                "subtitle": None,
                "amount": new_val,
                "currency": "EUR",
                "icon": "credit-card",
                "created_at": created,
            })
        for match in _DELETE_FOOTER_RE.finditer(content):
            name = match.group("name").strip()
            out.append({
                "type": "subscription",
                "title": f"Removed {name}",
                "subtitle": None,
                "amount": None,
                "currency": None,
                "icon": "trash",
                "created_at": created,
            })
    return out


def _dedupe_by_title(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Collapse repeats by (type, title), keeping the most recent entry.

    The caller must pass `items` already sorted by `created_at` descending;
    we exploit that by keeping the first occurrence of each key and dropping
    later (i.e. older) copies. This is the primary defence against the
    feed being flooded by repeated "Updated Midjourney → €11.16" footers or
    duplicate "Added event: …" rows.
    """
    seen: set[tuple[str, str]] = set()
    out: list[dict[str, Any]] = []
    for item in items:
        type_key = str(item.get("type") or "")
        title_key = str(item.get("title") or "").strip()
        if not type_key or not title_key:
            # Untyped/untitled entries are too noisy to dedupe on; emit as-is.
            out.append(item)
            continue
        key = (type_key, title_key)
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def build_feed(conn: sqlite3.Connection, limit: int = 30) -> list[dict[str, Any]]:
    """Aggregate all sources and return the top `limit` items by recency."""
    safe_limit = max(1, min(int(limit), 200))
    collectors: tuple[Iterable[dict[str, Any]], ...] = (
        _transactions_items(conn),
        _subscription_change_items(conn),
        _uploads_items(conn),
        _project_logs_items(conn),
        _events_items(conn),
        _observations_items(conn),
    )
    merged: list[dict[str, Any]] = []
    for batch in collectors:
        merged.extend(batch)
    # Drop entries we couldn't timestamp — they'd otherwise stack at the
    # top with empty `created_at`.
    merged = [item for item in merged if item.get("created_at")]
    merged.sort(key=lambda item: item.get("created_at") or "", reverse=True)
    merged = _dedupe_by_title(merged)
    return merged[:safe_limit]
