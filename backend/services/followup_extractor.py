from __future__ import annotations

import logging
import re
from datetime import date
from difflib import SequenceMatcher
from typing import Any

from database import execute, fetch_all, fetch_one
from services.llm_client import parse_json_object
from services.llm_client_shared import call_claude

logger = logging.getLogger("followup_extractor")

_SIMILARITY_THRESHOLD = 0.72
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

PROMPT = """
Проанализируй сообщение пользователя.
Есть ли в нём будущее событие или намерение которое стоит отследить?

Примеры:
- "встреча с Карлосом в пятницу" → спросить в субботу "как прошла встреча?"
- "начинаю курс" → спросить через неделю "как идёт курс?"
- "думаю бросить работу" → спросить через 3 дня "принял решение?"

Ответь JSON:
{
  "found": true,
  "event": "встреча с Карлосом",
  "followup_date": "2026-06-23",
  "question": "Как прошла встреча с Карлосом?"
}
или {"found": false}

followup_date — дата YYYY-MM-DD, когда стоит спросить (не раньше сегодня).
question — один короткий вопрос на русском.
"""


def _normalize_text(text: str) -> str:
    return " ".join(text.lower().split())


def _is_similar(a: str, b: str) -> bool:
    left = _normalize_text(a)
    right = _normalize_text(b)
    if not left or not right:
        return False
    if left == right:
        return True
    if len(left) >= 8 and len(right) >= 8 and (left in right or right in left):
        return True
    return SequenceMatcher(None, left, right).ratio() >= _SIMILARITY_THRESHOLD


def _parse_followup_date(raw: Any) -> str | None:
    value = str(raw or "").strip()[:10]
    if not _DATE_RE.match(value):
        return None
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        return None
    if parsed < date.today():
        return None
    return value


def _find_duplicate_pending(conn, event_text: str) -> dict[str, Any] | None:
    rows = fetch_all(
        conn,
        """
        SELECT id, event_text
        FROM followups
        WHERE status IN ('pending', 'sent')
        """,
    )
    for row in rows:
        if _is_similar(event_text, str(row.get("event_text") or "")):
            return row
    return None


def get_pending_followups_for_today(conn) -> list[dict[str, Any]]:
    return fetch_all(
        conn,
        """
        SELECT id, event_text, followup_date, question, status, created_at
        FROM followups
        WHERE status = 'pending'
          AND date(followup_date) <= date('now')
        ORDER BY date(followup_date) ASC, id ASC
        """,
    )


def mark_followups_sent(conn, followup_ids: list[int]) -> None:
    if not followup_ids:
        return
    placeholders = ",".join("?" * len(followup_ids))
    execute(
        conn,
        f"""
        UPDATE followups
           SET status = 'sent'
         WHERE id IN ({placeholders})
           AND status = 'pending'
        """,
        tuple(followup_ids),
    )


def mark_sent_followups_answered(conn) -> None:
    execute(
        conn,
        """
        UPDATE followups
           SET status = 'answered'
         WHERE status = 'sent'
        """,
    )


async def extract_followup(
    message: str, conn, api_key: str
) -> dict[str, Any] | None:
    """Analyze one user message and persist a follow-up when found."""
    text = (message or "").strip()
    if not text or not api_key.strip():
        return None

    today = date.today().isoformat()
    prompt = f"{PROMPT.strip()}\n\nСегодня: {today}\nСообщение: {text}"

    try:
        raw = await call_claude(prompt, api_key=api_key, max_tokens=300, temperature=0)
    except Exception:
        logger.exception("followup_extractor: LLM call failed")
        return None

    data = parse_json_object(raw)
    if not data.get("found"):
        return None

    event_text = str(data.get("event") or "").strip()
    question = str(data.get("question") or "").strip()
    followup_date = _parse_followup_date(data.get("followup_date"))

    if not event_text or not question or not followup_date:
        logger.info(
            "followup_extractor: found=true but missing/invalid fields; skipping"
        )
        return None

    event_text = event_text[:300]
    question = question[:500]

    if _find_duplicate_pending(conn, event_text) is not None:
        logger.info(
            "followup_extractor: duplicate pending followup for event=%r",
            event_text,
        )
        return None

    row_id = execute(
        conn,
        """
        INSERT INTO followups (event_text, followup_date, question, status)
        VALUES (?, ?, ?, 'pending')
        """,
        (event_text, followup_date, question),
    )
    logger.info(
        "followup_extractor: saved followup id=%s date=%s event=%r",
        row_id,
        followup_date,
        event_text,
    )
    return fetch_one(
        conn,
        """
        SELECT id, event_text, followup_date, question, status, created_at
        FROM followups
        WHERE id = ?
        """,
        (row_id,),
    )
