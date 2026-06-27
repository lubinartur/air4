"""Recommendation feedback loop — track advice, follow up, learn outcomes."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from database import execute, fetch_all, fetch_one
from services.llm_client import parse_json_object
from services.llm_client_shared import DEFAULT_MODEL, call_claude

logger = logging.getLogger("recommendation_feedback")

_VALID_DOMAINS = frozenset({"finance", "health", "projects", "life"})
_VALID_OUTCOMES = frozenset({"success", "failure", "partial"})

_DETECT_PROMPT = """
Проанализируй ответ ассистента AIR4.
Содержит ли он конкретную рекомендацию — что пользователю стоит сделать?

Конкретная рекомендация = явное действие или решение, не общий совет.
Примеры да: "разбери трансферы на этой неделе", "2 кардио до воскресенья".
Примеры нет: "подумай над финансами", "можно попробовать".

Верни ТОЛЬКО JSON без markdown:
{"has_recommendation": false}
или
{
  "has_recommendation": true,
  "recommendation": "краткая формулировка рекомендации",
  "domain": "finance|health|projects|life",
  "expected_action": "что пользователь должен сделать",
  "follow_up_days": 3
}

follow_up_days — через сколько дней спросить о результате (1–14).
"""


def _clamp_follow_up_days(raw: Any) -> int:
    try:
        days = int(raw)
    except (TypeError, ValueError):
        days = 3
    return max(1, min(14, days))


def _normalize_domain(raw: Any) -> str | None:
    domain = str(raw or "").strip().lower()
    return domain if domain in _VALID_DOMAINS else None


def create_recommendation_feedback(
    conn: Any,
    recommendation: str,
    domain: str | None = None,
    *,
    context: str | None = None,
    expected_action: str | None = None,
    follow_up_days: int = 3,
) -> int | None:
    """Insert a pending feedback row. Returns new id or None."""
    text = (recommendation or "").strip()
    if not text:
        return None
    days = _clamp_follow_up_days(follow_up_days)
    action = (expected_action or text).strip()[:500]
    ctx = (context or "").strip()[:1000] or None
    dom = _normalize_domain(domain)

    row_id = execute(
        conn,
        f"""
        INSERT INTO recommendation_feedback
            (recommendation, domain, context, expected_action, follow_up_date)
        VALUES (?, ?, ?, ?, datetime('now', '+{days} days'))
        """,
        (text[:500], dom, ctx, action),
    )
    logger.info(
        "recommendation_feedback: created id=%s domain=%s follow_up_days=%s",
        row_id,
        dom,
        days,
    )
    return row_id or None


def _has_recent_similar_pending(conn: Any, recommendation: str) -> bool:
    recent = fetch_one(
        conn,
        """
        SELECT id FROM recommendation_feedback
        WHERE status = 'pending'
          AND datetime(created_at) >= datetime('now', '-1 day')
          AND lower(recommendation) = lower(?)
        LIMIT 1
        """,
        (recommendation[:500],),
    )
    return recent is not None


async def detect_and_save_recommendation_feedback(
    conn: Any,
    assistant_response: str,
    user_message: str,
    api_key: str,
) -> dict[str, Any] | None:
    """Haiku check after assistant reply; persist feedback when found."""
    response = (assistant_response or "").strip()
    if not response or not api_key.strip():
        return None

    prompt = (
        f"{_DETECT_PROMPT.strip()}\n\n"
        f"Сообщение пользователя:\n{(user_message or '').strip()[:800]}\n\n"
        f"Ответ ассистента:\n{response[:2000]}"
    )
    try:
        raw = await call_claude(
            prompt, api_key=api_key, model=DEFAULT_MODEL, max_tokens=350, temperature=0
        )
    except Exception:
        logger.exception("recommendation_feedback: detection LLM failed")
        return None

    data = parse_json_object(raw)
    if not data.get("has_recommendation"):
        return None

    recommendation = str(data.get("recommendation") or "").strip()
    expected_action = str(data.get("expected_action") or "").strip()
    if not recommendation:
        return None

    if _has_recent_similar_pending(conn, recommendation):
        logger.info(
            "recommendation_feedback: skip duplicate pending %r", recommendation
        )
        return None

    row_id = create_recommendation_feedback(
        conn,
        recommendation,
        _normalize_domain(data.get("domain")),
        context=response[:1000],
        expected_action=expected_action or None,
        follow_up_days=_clamp_follow_up_days(data.get("follow_up_days")),
    )
    if not row_id:
        return None
    return fetch_one(
        conn,
        "SELECT * FROM recommendation_feedback WHERE id = ?",
        (row_id,),
    )


def get_pending_recommendation_followup(conn: Any) -> dict[str, Any] | None:
    """Oldest pending row whose follow_up_date has passed."""
    row = fetch_one(
        conn,
        """
        SELECT *
        FROM recommendation_feedback
        WHERE status = 'pending'
          AND datetime(follow_up_date) <= datetime('now')
        ORDER BY datetime(follow_up_date) ASC, id ASC
        LIMIT 1
        """,
    )
    if not row:
        return None
    expected = str(row.get("expected_action") or row.get("recommendation") or "").strip()
    return {
        "id": int(row["id"]),
        "recommendation": str(row.get("recommendation") or "").strip(),
        "expected_action": expected,
        "domain": row.get("domain"),
        "question": f"Ты делал {expected}? Как вышло?",
    }


def get_latest_pending_followup(conn: Any) -> dict[str, Any] | None:
    """Pending row for user-message matching (may be before follow_up_date)."""
    row = fetch_one(
        conn,
        """
        SELECT *
        FROM recommendation_feedback
        WHERE status = 'pending'
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT 1
        """,
    )
    return dict(row) if row else None


def _outcome_confidence_delta(outcome: str) -> float:
    if outcome == "success":
        return 0.15
    if outcome == "failure":
        return -0.10
    return 0.05


def apply_feedback_outcome(
    conn: Any,
    feedback_id: int,
    *,
    outcome: str,
    user_feedback: str,
) -> None:
    outcome_norm = str(outcome or "").strip().lower()
    if outcome_norm not in _VALID_OUTCOMES:
        outcome_norm = "partial"
    feedback_text = (user_feedback or "").strip()[:1000]
    delta = _outcome_confidence_delta(outcome_norm)
    execute(
        conn,
        """
        UPDATE recommendation_feedback
        SET status = 'done',
            outcome = ?,
            user_feedback = ?,
            confidence_delta = ?,
            updated_at = datetime('now')
        WHERE id = ?
          AND status = 'pending'
        """,
        (outcome_norm, feedback_text or None, delta, feedback_id),
    )
    logger.info(
        "recommendation_feedback: closed id=%s outcome=%s delta=%s",
        feedback_id,
        outcome_norm,
        delta,
    )


def _days_ago_label(ts: str | None) -> str:
    if not ts:
        return "недавно"
    try:
        when = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        if when.tzinfo is not None:
            when = when.replace(tzinfo=None)
        days = (datetime.now() - when).days
    except ValueError:
        return "недавно"
    if days <= 0:
        return "сегодня"
    if days == 1:
        return "1 день назад"
    if days < 5:
        return f"{days} дня назад"
    return f"{days} дней назад"


def _format_outcome_line(row: dict[str, Any]) -> str:
    rec = str(row.get("recommendation") or "").strip()
    outcome = str(row.get("outcome") or "").strip()
    feedback = str(row.get("user_feedback") or "").strip()
    when = _days_ago_label(row.get("updated_at") or row.get("created_at"))

    if outcome == "success":
        result = "сделал → успех"
    elif outcome == "failure":
        result = "не сделал → провал"
        if feedback:
            result = f"не сделал → причина: {feedback}"
    elif outcome == "partial":
        result = "частично"
        if feedback:
            result = f"частично → {feedback}"
    else:
        result = feedback or "закрыто"

    return f"- {rec} → {result} ({when})"


def get_recommendation_feedback_context(conn: Any, limit: int = 3) -> str:
    """Layer-4 block: recent completed recommendation outcomes."""
    rows = fetch_all(
        conn,
        """
        SELECT recommendation, outcome, user_feedback, created_at, updated_at
        FROM recommendation_feedback
        WHERE status = 'done'
        ORDER BY datetime(updated_at) DESC, id DESC
        LIMIT ?
        """,
        (limit,),
    )
    if not rows:
        return ""
    lines = ["[РЕЗУЛЬТАТЫ РЕКОМЕНДАЦИЙ]"]
    for row in rows:
        lines.append(_format_outcome_line(row))
    return "\n".join(lines)


def list_all_feedback(conn: Any) -> list[dict[str, Any]]:
    return fetch_all(
        conn,
        """
        SELECT *
        FROM recommendation_feedback
        ORDER BY datetime(created_at) DESC, id DESC
        """,
    )
