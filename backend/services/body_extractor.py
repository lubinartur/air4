from __future__ import annotations

import logging
import re
from datetime import date
from typing import Any

from database import execute, fetch_one

logger = logging.getLogger("body_extractor")

_WEIGHT_PATTERNS: list[re.Pattern[str]] = [
    re.compile(
        r"(?:вес|weight|weighs)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*(?:kg|кг)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"(\d+(?:[.,]\d+)?)\s*(?:kg|кг)\b(?=[^a-zа-яё]*(?:вес|weight))",
        re.IGNORECASE,
    ),
    re.compile(
        r"(?:вес|weight|weighs)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\b",
        re.IGNORECASE,
    ),
]

_HEIGHT_PATTERNS: list[re.Pattern[str]] = [
    re.compile(
        r"(?:рост|height)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*(?:cm|см)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"(\d+(?:[.,]\d+)?)\s*(?:cm|см)\b(?=[^a-zа-яё]*(?:рост|height))",
        re.IGNORECASE,
    ),
    re.compile(
        r"(?:рост|height)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\b",
        re.IGNORECASE,
    ),
]


def _parse_number(raw: str) -> float | None:
    try:
        return float(raw.replace(",", "."))
    except ValueError:
        return None


def _today_iso() -> str:
    return date.today().isoformat()


def _combined_text(messages: list[str]) -> str:
    return "\n".join(m.strip() for m in messages if (m or "").strip())


def _find_weight(text: str) -> float | None:
    for pattern in _WEIGHT_PATTERNS:
        match = pattern.search(text)
        if match:
            value = _parse_number(match.group(1))
            if value is not None and 30 <= value <= 300:
                return round(value, 2)
    return None


def _find_height(text: str) -> float | None:
    for pattern in _HEIGHT_PATTERNS:
        match = pattern.search(text)
        if match:
            value = _parse_number(match.group(1))
            if value is not None and 100 <= value <= 250:
                return round(value, 1)
    return None


def _upsert_body_metric(
    db: Any,
    *,
    today: str,
    weight: float | None = None,
    height: float | None = None,
) -> dict[str, Any] | None:
    if weight is None and height is None:
        return None

    row = fetch_one(
        db,
        "SELECT id, weight, height FROM body_metrics WHERE date = ?",
        (today,),
    )

    if row is None:
        metric_id = execute(
            db,
            """
            INSERT INTO body_metrics (date, weight, height, source, created_at)
            VALUES (?, ?, ?, 'chat', datetime('now'))
            """,
            (today, weight, height),
        )
    else:
        metric_id = int(row["id"])
        new_weight = weight if weight is not None else row.get("weight")
        new_height = height if height is not None else row.get("height")
        execute(
            db,
            """
            UPDATE body_metrics
            SET weight = ?, height = ?, source = 'chat', created_at = datetime('now')
            WHERE id = ?
            """,
            (new_weight, new_height, metric_id),
        )

    saved = fetch_one(db, "SELECT * FROM body_metrics WHERE id = ?", (metric_id,))
    return dict(saved) if saved else None


async def extract_body_data(user_messages: list[str], db: Any) -> list[dict]:
    """Extract weight/height from chat messages and upsert into body_metrics.

    Workouts are logged through two paths now: bulk imports from a Coaich
    backup (see backend/import_workouts.py) and per-message chat
    extraction (see services/workout_extractor.py, wired in
    routers/chat.py). This extractor only owns body metrics.
    """
    messages = [m.strip() for m in user_messages if (m or "").strip()]
    if not messages:
        return []

    text = _combined_text(messages)
    today = _today_iso()
    saved: list[dict] = []

    try:
        weight = _find_weight(text)
        if weight is not None:
            row = _upsert_body_metric(db, today=today, weight=weight)
            if row is not None:
                saved.append({"kind": "body_metric", **row})

        height = _find_height(text)
        if height is not None:
            row = _upsert_body_metric(db, today=today, height=height)
            if row is not None:
                if (
                    saved
                    and saved[-1].get("kind") == "body_metric"
                    and saved[-1].get("id") == row.get("id")
                ):
                    saved[-1] = {"kind": "body_metric", **row}
                else:
                    saved.append({"kind": "body_metric", **row})
    except Exception:
        logger.exception("extract_body_data failed")
        return []

    return saved
