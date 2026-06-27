"""Unified post-chat extractor — ONE Claude Haiku call instead of four.

Previously the chat router fired `event_extractor`, `workout_extractor`,
`fact_extractor` and `decision_extractor` sequentially — four LLM
requests back-to-back, which tripped Anthropic 429 rate limits. This
module collapses all four into a single Haiku call that returns one JSON
object, then fans the result out to the same DB tables.

To keep dedup/save behaviour identical (and avoid diverging from the
battle-tested logic), this reuses the existing per-extractor helpers
rather than reimplementing them. The original extractor modules are left
intact and importable — they're just no longer called from chat.py.
"""

from __future__ import annotations

import json
import logging
from datetime import date, timedelta
from typing import Any

from services.event_extractor import _normalize_event, _save_event
from services.fact_extractor import (
    _normalize_fact,
    _upsert_fact,
)
from services.decision_extractor import _find_duplicate, _merge_into_existing
from services.llm_client import parse_json_object
from services.llm_client_shared import DEFAULT_MODEL, call_claude
from services.workout_extractor import _normalize_workout, _save_workout

logger = logging.getLogger("unified_extractor")


def _build_prompt(user_messages: list[str]) -> str:
    today = date.today()
    yesterday = today - timedelta(days=1)
    joined = "\n".join(f"- {m}" for m in user_messages if m.strip())
    return (
        f"Сегодня: {today.isoformat()}. Вчера: {yesterday.isoformat()}.\n\n"
        "Проанализируй сообщения пользователя и извлеки структурированные данные.\n"
        "Верни ТОЛЬКО валидный JSON без markdown и пояснений:\n\n"
        "{\n"
        '  "events": [{"date": "YYYY-MM-DD", "title": "...", "description": "...", '
        '"domain": "life|finance|health|projects|personal", "importance": 1-4}],\n'
        '  "workout": null или {"date": "YYYY-MM-DD", "type": '
        '"strength|cardio|flexibility|other", "duration": int, "exercises": [], '
        '"notes": "..."},\n'
        '  "facts": [{"key": "...", "value": "..."}],\n'
        '  "decisions": [{"title": "...", "description": "...", "options": []}]\n'
        "}\n\n"
        "Правила:\n"
        "- events: только реальные жизненные события, НЕ мета-действия "
        '("добавил тренировку", "загрузил данные")\n'
        "- если дата не указана — используй сегодняшнюю; разрешай "
        "относительные даты (сегодня/вчера) по датам выше\n"
        "- workout: только если пользователь явно описал тренировку\n"
        "- facts: устойчивые факты о пользователе (не временные состояния)\n"
        "- decisions: только если пользователь описывает дилемму или важное решение\n"
        "- Если нечего извлекать — пустой массив [] или null\n\n"
        f"Сообщения пользователя:\n{joined}"
    )


def _save_events(conn: Any, items: Any, today_iso: str) -> list[dict[str, Any]]:
    saved: list[dict[str, Any]] = []
    if not isinstance(items, list):
        return saved
    for item in items:
        if not isinstance(item, dict):
            continue
        event = _normalize_event(item, today_iso)
        if not event:
            continue
        row = _save_event(conn, event)
        if row is not None:
            saved.append(row)
    return saved


def _save_workout_item(
    conn: Any, raw: Any, today_iso: str
) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    # The unified schema uses `duration` (int); `_normalize_workout`
    # expects `duration_minutes`. Bridge the key without mutating the
    # caller's object.
    adapted = dict(raw)
    if "duration_minutes" not in adapted and "duration" in adapted:
        adapted["duration_minutes"] = adapted.get("duration")
    workout = _normalize_workout(adapted, today_iso)
    if workout is None:
        return None
    return _save_workout(conn, workout)


def _save_facts(conn: Any, items: Any) -> list[dict[str, Any]]:
    saved: list[dict[str, Any]] = []
    if not isinstance(items, list):
        return saved
    for item in items:
        if not isinstance(item, dict):
            continue
        fact = _normalize_fact(item)
        if not fact:
            continue
        try:
            row = _upsert_fact(conn, fact)
            if row is not None:
                saved.append(row)
        except Exception:
            logger.exception("unified: failed to save fact %s", fact.get("key"))
    return saved


def _save_decision(conn: Any, raw: dict[str, Any]) -> dict[str, Any] | None:
    """Insert (or merge into) a dilemma from a unified decision object.

    Mirrors `decision_extractor` persistence: 24h title/tag dedup,
    followup_due = today + 14d so the Overview advisor can ask for the
    outcome later. The unified schema carries no status/tags, so new
    rows default to `open` with empty tags; `options` is stored as JSON.
    """
    title = str(raw.get("title") or "").strip()
    if not title:
        return None
    title = title[:300]
    description = str(raw.get("description") or "").strip() or None

    options = raw.get("options")
    if isinstance(options, (list, dict)):
        options_s = json.dumps(options, ensure_ascii=False) if options else None
    elif options is None:
        options_s = None
    else:
        options_s = str(options).strip() or None

    tags_clean: list[str] = []
    existing = _find_duplicate(conn, title=title, tags=tags_clean)
    if existing is not None:
        return _merge_into_existing(
            conn,
            existing,
            new_description=description,
            new_decision_made=None,
            new_status="open",
            new_tags=tags_clean,
        )

    followup_due = (date.today() + timedelta(days=14)).isoformat()
    try:
        cur = conn.execute(
            """
            INSERT INTO dilemmas
                (title, description, options, status, tags, followup_due)
            VALUES (?, ?, ?, 'open', ?, ?)
            """,
            (title, description, options_s, json.dumps(tags_clean), followup_due),
        )
        conn.commit()
        new_id = int(cur.lastrowid)
    except Exception:
        logger.exception("unified: failed to save decision %r", title)
        return None
    return {
        "id": new_id,
        "title": title,
        "status": "open",
        "followup_due": followup_due,
    }


def _save_decisions(conn: Any, items: Any) -> list[dict[str, Any]]:
    saved: list[dict[str, Any]] = []
    if not isinstance(items, list):
        return saved
    for item in items:
        if not isinstance(item, dict):
            continue
        row = _save_decision(conn, item)
        if row is not None:
            saved.append(row)
    return saved


async def extract_all(
    user_messages: list[str], conn: Any, api_key: str
) -> dict[str, Any]:
    """Single Haiku call → events, workout, facts, decisions.

    Returns a dict:
      {
        "events": [...saved rows...],
        "workout": {...saved row...} | None,
        "facts": [...saved rows...],
        "decisions": [...saved/merged rows...],
      }

    Never raises — on any failure it returns the empty-shaped result so
    the chat reply is never blocked.
    """
    empty: dict[str, Any] = {
        "events": [],
        "workout": None,
        "facts": [],
        "decisions": [],
    }

    messages = [m.strip() for m in user_messages if (m or "").strip()]
    if not messages or not api_key.strip():
        return empty

    try:
        raw_text = await call_claude(
            _build_prompt(messages), api_key=api_key, model=DEFAULT_MODEL
        )
    except Exception:
        logger.exception("unified: Claude call failed")
        return empty

    data = parse_json_object(raw_text)
    if not data:
        return empty

    today_iso = date.today().isoformat()

    try:
        events = _save_events(conn, data.get("events"), today_iso)
    except Exception:
        logger.exception("unified: event persistence failed")
        events = []

    try:
        workout = _save_workout_item(conn, data.get("workout"), today_iso)
    except Exception:
        logger.exception("unified: workout persistence failed")
        workout = None

    try:
        facts = _save_facts(conn, data.get("facts"))
    except Exception:
        logger.exception("unified: fact persistence failed")
        facts = []

    try:
        decisions = _save_decisions(conn, data.get("decisions"))
    except Exception:
        logger.exception("unified: decision persistence failed")
        decisions = []

    return {
        "events": events,
        "workout": workout,
        "facts": facts,
        "decisions": decisions,
    }
