from __future__ import annotations

import json
import logging
from datetime import date, timedelta
from typing import Any

from database import execute, fetch_one
from services.llm_client import parse_json_object
from services.llm_client_shared import DEFAULT_MODEL, call_claude

logger = logging.getLogger("workout_extractor")

VALID_TYPES = frozenset({"strength", "cardio", "yoga", "stretch", "other"})


def _build_prompt(user_messages: list[str]) -> str:
    today = date.today()
    yesterday = today - timedelta(days=1)
    joined = "\n\n".join(f"- {m}" for m in user_messages if m.strip())
    return (
        f"Today is {today.isoformat()}. Yesterday was {yesterday.isoformat()}.\n\n"
        "Read the user messages below. If the user describes a workout — "
        "a completed training session such as gym/strength, running, "
        "rowing (гребля), swimming, cycling, yoga, or stretching — "
        "extract it. Use only the user's own words and facts; do not "
        "invent details.\n\n"
        f"User messages:\n{joined}\n\n"
        "Return ONLY a JSON object (no markdown, no explanation) with these fields:\n"
        "{\n"
        '  "date": "YYYY-MM-DD",\n'
        '  "type": "strength|cardio|yoga|stretch|other",\n'
        '  "duration_minutes": integer or null,\n'
        '  "exercises": [{"name": "...", "sets": [{"weight": number, "reps": int}]}],\n'
        '  "notes": "free-form notes or null"\n'
        "}\n\n"
        "Rules:\n"
        "- If the user did not specify a date, use today's date.\n"
        "- Resolve relative dates like today/yesterday using the dates above.\n"
        "- `type` mapping:\n"
        "    • strength — gym, weights, силовая, push/pull/legs\n"
        "    • cardio   — run/бег, row/гребля, swim/плавание, "
        "bike/велосипед, erg, treadmill, HIIT, любые сессии с пульсом / "
        "дистанцией / темпом\n"
        "    • yoga     — yoga, pilates, мобильность\n"
        "    • stretch  — stretching, растяжка, foam roll\n"
        "    • other    — only when none of the above fit.\n"
        "- `exercises` may be an empty array when the user only mentioned the "
        "session at a high level (e.g. \"бегал 30 минут\").\n"
        "- Stash extra cardio numbers (distance, average heart rate, pace) in "
        "`notes` — they're useful context even though there's no dedicated column.\n"
        "- If there is no workout in the messages, return exactly: null"
    )


def _normalize_exercises(raw: Any) -> str | None:
    if raw is None:
        return None
    if isinstance(raw, str):
        return raw.strip() or None
    try:
        return json.dumps(raw, ensure_ascii=False)
    except (TypeError, ValueError):
        return None


def _normalize_workout(raw: dict[str, Any], today_iso: str) -> dict[str, Any] | None:
    workout_type = str(raw.get("type") or "").strip().lower() or None
    if workout_type and workout_type not in VALID_TYPES:
        workout_type = "other"

    workout_date = str(raw.get("date") or today_iso).strip() or today_iso

    duration_raw = raw.get("duration_minutes")
    duration: int | None
    if duration_raw is None:
        duration = None
    else:
        try:
            duration = int(duration_raw)
        except (TypeError, ValueError):
            duration = None
        else:
            if duration <= 0:
                duration = None

    exercises_s = _normalize_exercises(raw.get("exercises"))

    notes_raw = raw.get("notes")
    notes_s: str | None
    if notes_raw is None:
        notes_s = None
    else:
        notes_s = str(notes_raw).strip() or None

    # Reject empty extractions — nothing meaningful to persist.
    if (
        workout_type is None
        and duration is None
        and not exercises_s
        and not notes_s
    ):
        return None

    return {
        "date": workout_date,
        "type": workout_type,
        "duration": duration,
        "exercises": exercises_s,
        "notes": notes_s,
    }


def _find_duplicate(db: Any, workout_date: str) -> dict[str, Any] | None:
    """Skip if a workout already exists on the same date.

    Mirrors `import_workouts.py` dedup (same date) so chat-sourced and
    Coaich-imported rows don't double up when both arrive for one day.
    """
    return fetch_one(
        db,
        "SELECT id, date, type, source FROM workouts WHERE date = ? LIMIT 1",
        (workout_date,),
    )


def _save_workout(db: Any, workout: dict[str, Any]) -> dict[str, Any] | None:
    workout_date = workout["date"]
    duplicate = _find_duplicate(db, workout_date)
    if duplicate is not None:
        logger.info(
            "workouts: dedup skip on %s → matches existing id=%s source=%s",
            workout_date,
            duplicate.get("id"),
            duplicate.get("source"),
        )
        return None

    try:
        workout_id = execute(
            db,
            """
            INSERT INTO workouts (
                date, type, duration, exercises, notes, source, created_at
            )
            VALUES (?, ?, ?, ?, ?, 'chat', datetime('now'))
            """,
            (
                workout["date"],
                workout["type"],
                workout["duration"],
                workout["exercises"],
                workout["notes"],
            ),
        )
        row = fetch_one(db, "SELECT * FROM workouts WHERE id = ?", (workout_id,))
        return dict(row) if row is not None else None
    except Exception:
        logger.exception("Failed to save workout for %s", workout_date)
        return None


def format_workout_footer(workout: dict[str, Any] | None) -> str:
    """Markdown footer the chat router appends when a workout was logged.

    Mirrors `subscription_updater.format_confirmation` so the user gets a
    consistent inline receipt — `_Записал: cardio, 2026-05-31, 33 мин_`.
    Returns an empty string when there's nothing to confirm.
    """
    if not workout:
        return ""

    parts: list[str] = []
    wtype = str(workout.get("type") or "").strip()
    if wtype:
        parts.append(wtype)

    wdate = str(workout.get("date") or "").strip()
    if wdate:
        parts.append(wdate)

    duration = workout.get("duration")
    if duration is not None:
        try:
            parts.append(f"{int(duration)} мин")
        except (TypeError, ValueError):
            pass

    if not parts:
        return ""
    return "\n\n_Записал: " + ", ".join(parts) + "_"


async def extract_workout(
    user_messages: list[str], db: Any, api_key: str
) -> dict | None:
    """Extract a workout from chat messages and insert it into `workouts`.

    Returns the saved row, or ``None`` if the LLM found no workout, the
    payload was empty, or a workout already exists on that date.
    """
    messages = [m.strip() for m in user_messages if (m or "").strip()]
    if not messages:
        return None

    try:
        raw_text = await call_claude(
            _build_prompt(messages), api_key=api_key, model=DEFAULT_MODEL
        )
    except Exception:
        logger.exception("Claude workout extraction failed")
        return None

    if not raw_text or raw_text.strip().lower() == "null":
        return None

    item = parse_json_object(raw_text)
    if not item:
        return None

    today_iso = date.today().isoformat()
    workout = _normalize_workout(item, today_iso)
    if workout is None:
        return None

    return _save_workout(db, workout)
