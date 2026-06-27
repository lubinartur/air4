"""Detect when a user message answers a pending recommendation follow-up."""

from __future__ import annotations

import logging
from typing import Any

from services.llm_client import parse_json_object
from services.llm_client_shared import DEFAULT_MODEL, call_claude
from services.recommendation_feedback import (
    apply_feedback_outcome,
    get_latest_pending_followup,
)

logger = logging.getLogger("feedback_extractor")

_ANSWER_PROMPT = """
Пользователь отвечает на follow-up по рекомендации AIR4.

Рекомендация: {recommendation}
Ожидалось: {expected_action}

Сообщение пользователя:
{message}

Ответил ли пользователь — сделал ли он рекомендацию или объяснил почему нет?
Верни ТОЛЬКО JSON:
{{"answered": false}}
или
{{
  "answered": true,
  "outcome": "success|failure|partial",
  "user_feedback": "кратко что сказал пользователь"
}}

outcome:
- success — сделал / получилось
- failure — не сделал / не получилось
- partial — частично / в процессе
"""


async def extract_feedback_answer(
    message: str, conn: Any, api_key: str
) -> dict[str, Any] | None:
    """If the user message closes a pending recommendation, update the row."""
    text = (message or "").strip()
    if not text or not api_key.strip():
        return None

    pending = get_latest_pending_followup(conn)
    if not pending:
        return None

    recommendation = str(pending.get("recommendation") or "").strip()
    expected = str(
        pending.get("expected_action") or pending.get("recommendation") or ""
    ).strip()
    if not recommendation:
        return None

    prompt = _ANSWER_PROMPT.format(
        recommendation=recommendation[:400],
        expected_action=expected[:400],
        message=text[:1200],
    )
    try:
        raw = await call_claude(
            prompt, api_key=api_key, model=DEFAULT_MODEL, max_tokens=250, temperature=0
        )
    except Exception:
        logger.exception("feedback_extractor: LLM call failed")
        return None

    data = parse_json_object(raw)
    if not data.get("answered"):
        return None

    outcome = str(data.get("outcome") or "partial").strip().lower()
    user_feedback = str(data.get("user_feedback") or text).strip()
    feedback_id = int(pending["id"])
    apply_feedback_outcome(
        conn,
        feedback_id,
        outcome=outcome,
        user_feedback=user_feedback,
    )
    return {
        "id": feedback_id,
        "outcome": outcome,
        "user_feedback": user_feedback,
    }
