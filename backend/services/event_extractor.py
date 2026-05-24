from __future__ import annotations

import json
import logging
import re
from datetime import date, timedelta
from difflib import SequenceMatcher
from typing import Any

from database import execute, fetch_all, fetch_one
from services.llm_client import parse_json_array
from services.llm_client_shared import DEFAULT_MODEL, call_claude

logger = logging.getLogger("event_extractor")

VALID_DOMAINS = frozenset({"finance", "health", "projects", "life", "personal"})
VALID_CATEGORIES = frozenset(
    {"workout", "expense", "milestone", "meeting", "decision", "goal", "note"}
)

# Title similarity threshold for dedup. The LLM rephrases the same
# logical event differently every time the user mentions it ("Сдать
# анализы" → "Сдача анализов" → "Планируемые анализы крови"), so a
# strict `title = ?` check let dozens of near-duplicates through.
# 0.85 matches the spec and lines up with `routers/goals.py`
# (which uses the same threshold for goal-row dedup).
_TITLE_SIMILARITY_THRESHOLD = 0.85
# ±1 day window. Sample the LLM-suggested date plus its neighbors so
# the same event mentioned slightly differently across days collapses.
_DEDUP_WINDOW_DAYS = 1


def _build_prompt(user_messages: list[str]) -> str:
    today = date.today()
    yesterday = today - timedelta(days=1)
    joined = "\n\n".join(f"- {m}" for m in user_messages if m.strip())
    return (
        f"Today is {today.isoformat()}. Yesterday was {yesterday.isoformat()}.\n\n"
        "Read the user messages below. Extract concrete events the user mentioned — "
        "things that happened, they did, plan to do, paid for, or bought. "
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
        "- Personal expenses, purchases, and one-off payments are valid events.\n"
        '  Example: "Потратил на обслуживание мотоцикла 150 евро" →\n'
        '  {"title": "Обслуживание мотоцикла", "domain": "finance",\n'
        '   "category": "expense", "metadata": {"amount_eur": 150}}.\n'
        '  Example: "Купил книгу за 25 евро" → category="expense".\n'
        '  Do NOT skip these — they are events, not just transactions.\n'
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


def _normalize_title(text: str) -> str:
    """Canonical form for cross-row title comparison. Lowercases,
    unifies all dash glyphs, strips punctuation, collapses whitespace
    so 'Сдать анализы' and 'Сдать анализы.' compare as the same
    title."""
    s = (text or "").strip().lower()
    s = re.sub(r"[\u2010-\u2015\-]", " ", s)
    s = re.sub(r"[^\w\s]", " ", s, flags=re.UNICODE)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _find_duplicate(
    db: Any, title: str, event_date: str
) -> dict[str, Any] | None:
    """Find a near-duplicate event within ±1 day of `event_date`.

    A row counts as a duplicate when its normalized title's
    `SequenceMatcher.ratio()` against the candidate is ≥0.85.

    The old exact-match dedup let dozens of LLM rephrasings of the
    same logical event ("Сдать анализы" / "Сдача анализов" /
    "Планируемые анализы") through — see the cleanup tool in
    `_cleanup.py` for what that historically looked like.
    """
    rows = fetch_all(
        db,
        """
        SELECT id, title, date
        FROM events
        WHERE date BETWEEN date(?, ?) AND date(?, ?)
        """,
        (
            event_date,
            f"-{_DEDUP_WINDOW_DAYS} day",
            event_date,
            f"+{_DEDUP_WINDOW_DAYS} day",
        ),
    )
    if not rows:
        return None
    candidate_norm = _normalize_title(title)
    if not candidate_norm:
        return None
    best: tuple[float, dict[str, Any]] | None = None
    for row in rows:
        existing_norm = _normalize_title(str(row.get("title") or ""))
        if not existing_norm:
            continue
        ratio = SequenceMatcher(None, candidate_norm, existing_norm).ratio()
        if ratio < _TITLE_SIMILARITY_THRESHOLD:
            continue
        if best is None or ratio > best[0]:
            best = (ratio, dict(row))
    return best[1] if best else None


def _save_event(db: Any, event: dict[str, Any]) -> dict[str, Any] | None:
    """Insert event unless a near-duplicate exists within ±1 day."""
    title = event["title"]
    event_date = event["date"]
    duplicate = _find_duplicate(db, title, event_date)
    if duplicate is not None:
        logger.info(
            "events: dedup skip '%s' on %s → matches existing id=%s '%s' on %s",
            title,
            event_date,
            duplicate.get("id"),
            duplicate.get("title"),
            duplicate.get("date"),
        )
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
