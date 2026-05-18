from __future__ import annotations

import json
import logging
from datetime import date, timedelta
from typing import Any

from database import execute, fetch_one
from services.llm_client import parse_json_array
from services.llm_client_shared import DEFAULT_MODEL, call_claude

logger = logging.getLogger("event_extractor")

VALID_DOMAINS = frozenset({"finance", "health", "projects", "life", "personal"})
VALID_CATEGORIES = frozenset(
    {"workout", "expense", "milestone", "meeting", "decision", "goal", "note"}
)


def _build_prompt(user_messages: list[str]) -> str:
    today = date.today()
    yesterday = today - timedelta(days=1)
    joined = "\n\n".join(f"- {m}" for m in user_messages if m.strip())
    return (
        f"Today is {today.isoformat()}. Yesterday was {yesterday.isoformat()}.\n\n"
        "Read the user messages below. Extract concrete events the user mentioned — "
        "things that happened, they did, or they plan to do. "
        "Use only the user's own words and facts; do not invent events or add AI conclusions.\n\n"
        f"User messages:\n{joined}\n\n"
        "Return ONLY a JSON array (no markdown, no explanation). Each object:\n"
        "{\n"
        '  "date": "YYYY-MM-DD",\n'
        '  "title": "short title",\n'
        '  "description": "optional longer text or null",\n'
        '  "domain": "finance|health|projects|life|personal",\n'
        '  "category": "workout|expense|milestone|meeting|decision|goal|note",\n'
        '  "importance": 1-4,\n'
        '  "metadata": {} or null\n'
        "}\n\n"
        "Rules:\n"
        "- If the user did not specify a date, use today's date.\n"
        "- Resolve relative dates like today/yesterday using the dates above.\n"
        "- If there are no events, return []."
    )


def _normalize_event(raw: dict[str, Any], today_iso: str) -> dict[str, Any] | None:
    title = str(raw.get("title") or "").strip()
    if not title:
        return None

    domain = str(raw.get("domain") or "life").strip().lower()
    if domain not in VALID_DOMAINS:
        domain = "life"

    category = str(raw.get("category") or "").strip().lower()
    if category and category not in VALID_CATEGORIES:
        category = "note"
    if not category:
        category = "note"

    event_date = str(raw.get("date") or today_iso).strip() or today_iso

    try:
        importance = int(raw.get("importance", 2))
    except (TypeError, ValueError):
        importance = 2
    importance = max(1, min(4, importance))

    description = raw.get("description")
    description_s: str | None
    if description is None:
        description_s = None
    else:
        description_s = str(description).strip() or None

    metadata = raw.get("metadata")
    if metadata is None:
        metadata_s = None
    elif isinstance(metadata, str):
        metadata_s = metadata.strip() or None
    else:
        metadata_s = json.dumps(metadata, ensure_ascii=False)

    return {
        "date": event_date,
        "title": title,
        "description": description_s,
        "domain": domain,
        "category": category,
        "importance": importance,
        "metadata": metadata_s,
    }


def _save_event(db: Any, event: dict[str, Any]) -> dict[str, Any] | None:
    """Insert event unless a duplicate title exists within ±1 day."""
    title = event["title"]
    date = event["date"]
    existing = db.execute(
        "SELECT id FROM events WHERE title = ? AND date BETWEEN date(?, '-1 day') AND date(?, '+1 day') LIMIT 1",
        (title, date, date),
    ).fetchone()
    if existing:
        logger.debug("Skipping duplicate event: %s on %s", title, date)
        return None

    try:
        event_id = execute(
            db,
            """
            INSERT INTO events (
                date, title, description, domain, category,
                importance, metadata, source, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, 'chat', datetime('now'))
            """,
            (
                event["date"],
                event["title"],
                event["description"],
                event["domain"],
                event["category"],
                event["importance"],
                event["metadata"],
            ),
        )
        row = fetch_one(db, "SELECT * FROM events WHERE id = ?", (event_id,))
        return dict(row) if row is not None else None
    except Exception:
        logger.exception("Failed to save event: %s", title)
        return None


async def extract_events(
    user_messages: list[str], db: Any, api_key: str
) -> list[dict]:
    messages = [m.strip() for m in user_messages if (m or "").strip()]
    if not messages:
        return []

    today_iso = date.today().isoformat()
    try:
        raw_text = await call_claude(
            _build_prompt(messages), api_key=api_key, model=DEFAULT_MODEL
        )
        items = parse_json_array(raw_text)
    except Exception:
        logger.exception("Claude event extraction failed")
        return []

    saved: list[dict] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        event = _normalize_event(item, today_iso)
        if not event:
            continue
        row = _save_event(db, event)
        if row is not None:
            saved.append(row)

    return saved
