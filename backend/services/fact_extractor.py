from __future__ import annotations

import logging
import re
from typing import Any

from database import execute, fetch_all, fetch_one
from services.llm_client import parse_json_array
from services.llm_client_shared import DEFAULT_MODEL, call_claude

logger = logging.getLogger("fact_extractor")


def _normalize_key(raw: str) -> str | None:
    s = (raw or "").strip().lower().replace(" ", "_")
    s = re.sub(r"[^a-z0-9_]+", "_", s)
    s = re.sub(r"_+", "_", s).strip("_")
    if not s or len(s) > 80:
        return None
    return s


def _build_prompt(user_messages: list[str]) -> str:
    joined = "\n\n".join(f"- {m}" for m in user_messages if m.strip())
    return (
        "Read the user messages below. Extract stable characteristics about THE USER "
        "themselves — habits, preferences, patterns of behavior, constraints, goals "
        "stated as enduring traits.\n\n"
        "A fact is NOT a one-time event "
        '(e.g. "works at night" is a fact; "worked tonight" is not).\n\n'
        "Do NOT extract as facts:\n"
        "- Test messages, nonsense, random words, or gibberish\n"
        "- Names of other people mentioned in conversation (not the user)\n"
        "- Single mentions without enough context to be a stable trait\n"
        "- Opinions about third parties or external projects\n"
        "- Greetings and small talk (hi, thanks, how are you, etc.)\n\n"
        "A valid fact must describe a durable characteristic of THE USER. "
        "If you are unsure — do not extract. Prefer skipping over saving noise.\n\n"
        f"User messages:\n{joined}\n\n"
        "Return ONLY a JSON array (no markdown, no explanation). Each object:\n"
        "{\n"
        '  "key": "snake_case_identifier",\n'
        '  "value": "1-2 sentences in the user\'s language",\n'
        '  "confidence": 0.5-1.0\n'
        "}\n\n"
        "Rules:\n"
        "- key must be snake_case English.\n"
        "- confidence between 0.5 and 1.0.\n"
        "- If there are no facts, return []."
    )


def _first_two_words(key: str) -> tuple[str, ...]:
    parts = [p for p in key.split("_") if p]
    if len(parts) >= 2:
        return (parts[0], parts[1])
    if parts:
        return (parts[0],)
    return ()


def _find_similar_key(db: Any, key: str) -> str | None:
    """Find an existing fact key whose first two underscore-segments match."""
    prefix = _first_two_words(key)
    if len(prefix) < 2:
        return None
    for row in fetch_all(db, "SELECT key FROM user_facts"):
        existing_key = str(row["key"])
        if existing_key == key:
            continue
        if _first_two_words(existing_key) == prefix:
            return existing_key
    return None


def _upsert_fact(db: Any, fact: dict[str, Any]) -> dict[str, Any] | None:
    key = fact["key"]
    existing = fetch_one(
        db,
        "SELECT id, confidence FROM user_facts WHERE key = ?",
        (key,),
    )
    target_key = key
    if existing is None:
        similar = _find_similar_key(db, key)
        if similar:
            target_key = similar
            existing = fetch_one(
                db,
                "SELECT id, confidence FROM user_facts WHERE key = ?",
                (target_key,),
            )

    if existing is not None:
        old_conf = float(existing.get("confidence") or 0)
        if fact["confidence"] < old_conf:
            return fetch_one(
                db, "SELECT * FROM user_facts WHERE key = ?", (target_key,)
            )
        execute(
            db,
            """
            UPDATE user_facts
            SET value = ?, confidence = ?, source = 'chat',
                updated_at = datetime('now')
            WHERE key = ?
            """,
            (fact["value"], fact["confidence"], target_key),
        )
    else:
        execute(
            db,
            """
            INSERT INTO user_facts (key, value, confidence, source, updated_at)
            VALUES (?, ?, ?, 'chat', datetime('now'))
            """,
            (fact["key"], fact["value"], fact["confidence"]),
        )
        target_key = fact["key"]

    row = fetch_one(db, "SELECT * FROM user_facts WHERE key = ?", (target_key,))
    return dict(row) if row is not None else None


def _normalize_fact(raw: dict[str, Any]) -> dict[str, Any] | None:
    key = _normalize_key(str(raw.get("key") or ""))
    value = str(raw.get("value") or "").strip()
    if not key or not value:
        return None

    try:
        confidence = float(raw.get("confidence", 0.8))
    except (TypeError, ValueError):
        confidence = 0.8
    confidence = max(0.5, min(1.0, confidence))

    return {"key": key, "value": value, "confidence": confidence}


async def extract_facts(
    user_messages: list[str], db: Any, api_key: str
) -> list[dict]:
    messages = [m.strip() for m in user_messages if (m or "").strip()]
    if not messages:
        return []

    try:
        raw_text = await call_claude(
            _build_prompt(messages), api_key=api_key, model=DEFAULT_MODEL
        )
        items = parse_json_array(raw_text)
    except Exception:
        logger.exception("Claude fact extraction failed")
        return []

    saved: list[dict] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        fact = _normalize_fact(item)
        if not fact:
            continue
        try:
            row = _upsert_fact(db, fact)
            if row is not None:
                saved.append(row)
        except Exception:
            logger.exception("Failed to save fact: %s", fact.get("key"))

    return saved
