"""Proactive AIR4 openings — morning brief and observer nudges."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from database import fetch_all, fetch_one, get_meta, set_meta
from services.discovery import get_open_gaps, mark_gaps_asked_in_response
from services.llm_client_shared import DEFAULT_MODEL, call_claude
from services.prompts import CHAT_RESPONSE_FORMAT
from services.test_mode import is_test_mode

logger = logging.getLogger("proactive_chat")

SONNET_MODEL = "claude-sonnet-4-5"

_PROD_INACTIVITY_HOURS = 4
_TEST_INACTIVITY_MINUTES = 5
_PROD_NUDGE_COOLDOWN_SECONDS = 2 * 60 * 60
_TEST_NUDGE_COOLDOWN_SECONDS = 2 * 60
_PROD_NUDGE_MIN_SECONDS = 45 * 60
_TEST_NUDGE_MIN_SECONDS = 2 * 60


def inactivity_threshold_hours() -> float:
    if is_test_mode():
        return _TEST_INACTIVITY_MINUTES / 60.0
    return float(_PROD_INACTIVITY_HOURS)


def observer_nudge_cooldown_seconds() -> int:
    if is_test_mode():
        return _TEST_NUDGE_COOLDOWN_SECONDS
    return _PROD_NUDGE_COOLDOWN_SECONDS


def observer_nudge_min_seconds() -> int:
    if is_test_mode():
        return _TEST_NUDGE_MIN_SECONDS
    return _PROD_NUDGE_MIN_SECONDS

_MORNING_BRIEF_PROMPT = (
    "You are AIR4. Generate a morning opening message in Russian.\n"
    "Be direct and personal. One primary thing to say, one question to ask. "
    "Max 3 sentences total.\n"
    "Never say 'доброе утро' or generic greetings.\n"
    "If there is a discovery gap, weave ONE natural question into the brief — "
    "not an interview, not 'расскажи о...'. Connect it to observer data or "
    "today's signal when possible.\n"
    "Example: observer shows Cursor late at night + gap is work_hours → "
    "'Уже второй час ночи в Cursor. Это твой обычный режим?'\n\n"
    "Pick the most interesting angle. Make it feel like someone who was "
    "thinking about you overnight.\n\n"
    "Context:\n"
    "Open loop: {open_loop}\n"
    "Unknown about user: {discovery_gap}\n"
    "Yesterday activity: {observer_summary}\n"
    "Today's signal: {today_signal}\n\n"
    + CHAT_RESPONSE_FORMAT
)

_OBSERVER_NUDGE_PROMPT = (
    "Ты AIR4. Напиши одно короткое сообщение на русском (1 предложение).\n"
    "Пользователь уже {minutes} минут в {app}{project_part}.\n"
    "Тон: спокойный, без морали. Можно спросить как идёт или мягко отметить время.\n"
    "Примеры: 'Cursor · air4 уже 50 минут. Как идёт?' или "
    "'Долго в Telegram — всё ок?'\n"
    "Без приветствий. Только текст сообщения."
)


def _gap_short_label(question_hint: str) -> str:
    text = question_hint.split("—")[0].strip()
    return text.replace(" пользователя", "").replace(" пользователь", "")


def get_top_open_loop(conn: Any) -> str | None:
    row = fetch_one(
        conn,
        """
        SELECT topic, domain, priority
        FROM open_loops
        WHERE COALESCE(status, 'open') = 'open'
        ORDER BY
            CASE priority
                WHEN 'high' THEN 3
                WHEN 'medium' THEN 2
                ELSE 1
            END DESC,
            datetime(created_at) DESC,
            id DESC
        LIMIT 1
        """,
    )
    if not row:
        return None
    topic = str(row.get("topic") or "").strip()
    if not topic:
        return None
    domain = str(row.get("domain") or "").strip()
    if domain:
        return f"{topic} ({domain})"
    return topic


def get_top_discovery_gap(conn: Any) -> dict[str, Any] | None:
    gaps = get_open_gaps(conn, limit=1)
    return gaps[0] if gaps else None


def get_yesterday_observer_summary(conn: Any) -> str | None:
    rows = fetch_all(
        conn,
        """
        SELECT app_name, project_hint, SUM(duration_seconds) AS total_seconds
        FROM observer_events
        WHERE date(observed_at) = date('now', '-1 day', 'localtime')
        GROUP BY app_name, project_hint
        ORDER BY total_seconds DESC
        """,
    )
    if not rows:
        return None
    total_seconds = sum(int(r.get("total_seconds") or 0) for r in rows)
    if total_seconds < 30 * 60:
        return None
    parts: list[str] = []
    for row in rows[:4]:
        app = str(row.get("app_name") or "")
        project = (row.get("project_hint") or "").strip()
        minutes = int(row.get("total_seconds") or 0) // 60
        label = f"{app} · {project}" if project else app
        parts.append(f"{label} {minutes}мин")
    return f"вчера {total_seconds // 60}мин: " + ", ".join(parts)


def get_recent_observer_signal(conn: Any, minutes: int = 30) -> str | None:
    rows = fetch_all(
        conn,
        """
        SELECT app_name, project_hint, SUM(duration_seconds) AS total_seconds
        FROM observer_events
        WHERE datetime(observed_at) >= datetime('now', ? || ' minutes')
        GROUP BY app_name, project_hint
        HAVING total_seconds >= 60
        ORDER BY total_seconds DESC
        LIMIT 3
        """,
        (f"-{minutes}",),
    )
    if not rows:
        return None
    parts: list[str] = []
    for row in rows:
        app = str(row.get("app_name") or "")
        project = (row.get("project_hint") or "").strip()
        mins = int(row.get("total_seconds") or 0) // 60
        label = f"{app} · {project}" if project else app
        parts.append(f"{label} {mins}мин")
    return "последние 30 мин: " + ", ".join(parts)


def get_today_signal(conn: Any) -> str | None:
    try:
        from routers.recommendation import _cache as rec_cache

        cached = rec_cache.get("data")
        if cached is not None:
            text = str(getattr(cached, "recommendation", "") or "").strip()
            if text:
                return text[:600]
    except Exception:
        logger.exception("proactive: failed to read recommendation cache")

    row = fetch_one(
        conn,
        """
        SELECT recommendation FROM dilemmas
        WHERE recommendation IS NOT NULL AND TRIM(recommendation) != ''
        ORDER BY datetime(updated_at) DESC, id DESC
        LIMIT 1
        """,
    )
    if row and row.get("recommendation"):
        return str(row["recommendation"]).strip()[:600]
    return None


def hours_since_last_user_message(conn: Any) -> float | None:
    row = fetch_one(
        conn,
        "SELECT MAX(created_at) AS ts FROM chat_messages WHERE role = 'user'",
    )
    ts = (row or {}).get("ts")
    if not ts:
        return None
    try:
        last = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except ValueError:
        return None
    if last.tzinfo is not None:
        last = last.replace(tzinfo=None)
    delta = datetime.now() - last
    return delta.total_seconds() / 3600.0


def should_show_proactive_brief(conn: Any) -> bool:
    """True when any proactive trigger fires."""
    inactive_hours = hours_since_last_user_message(conn)
    if inactive_hours is None or inactive_hours >= inactivity_threshold_hours():
        return True
    if get_top_discovery_gap(conn) is not None:
        return True
    if get_recent_observer_signal(conn, minutes=30) is not None:
        return True
    return False


def collect_morning_signals(conn: Any) -> dict[str, Any]:
    gap = get_top_discovery_gap(conn)
    discovery_text = "—"
    gap_category: str | None = None
    if gap:
        gap_category = str(gap.get("category") or "")
        discovery_text = _gap_short_label(str(gap.get("question_hint") or ""))

    return {
        "open_loop": get_top_open_loop(conn) or "—",
        "discovery_gap": discovery_text,
        "discovery_gap_category": gap_category,
        "observer_summary": get_yesterday_observer_summary(conn) or "—",
        "today_signal": get_today_signal(conn) or "—",
        "recent_observer": get_recent_observer_signal(conn, minutes=30) or "—",
    }


def build_morning_brief_prompt(signals: dict[str, Any]) -> str:
    observer = signals.get("observer_summary") or "—"
    recent = signals.get("recent_observer")
    if recent and recent != "—":
        observer = f"{observer}; {recent}" if observer != "—" else recent
    return _MORNING_BRIEF_PROMPT.format(
        open_loop=signals.get("open_loop") or "—",
        discovery_gap=signals.get("discovery_gap") or "—",
        observer_summary=observer,
        today_signal=signals.get("today_signal") or "—",
    )


def mark_discovery_gap_asked(conn: Any, category: str | None) -> None:
    if not category:
        return
    conn.execute(
        """
        UPDATE discovery_gaps
        SET last_asked = datetime('now'), updated_at = datetime('now')
        WHERE category = ? AND status = 'open'
        """,
        (category,),
    )


def _parse_meta_timestamp(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def _observer_nudge_cooldown_active(conn: Any) -> bool:
    last = _parse_meta_timestamp(get_meta(conn, "observer_nudge_last_at"))
    if not last:
        return False
    return (datetime.now() - last).total_seconds() < observer_nudge_cooldown_seconds()


def _longest_recent_app_session(conn: Any, minutes: int = 60) -> dict[str, Any] | None:
    rows = fetch_all(
        conn,
        """
        SELECT app_name, project_hint, SUM(duration_seconds) AS total_seconds
        FROM observer_events
        WHERE datetime(observed_at) >= datetime('now', ? || ' minutes')
        GROUP BY app_name, project_hint
        ORDER BY total_seconds DESC
        LIMIT 1
        """,
        (f"-{minutes}",),
    )
    if not rows:
        return None
    top = rows[0]
    seconds = int(top.get("total_seconds") or 0)
    if seconds < observer_nudge_min_seconds():
        return None
    return {
        "app": str(top.get("app_name") or ""),
        "project": (top.get("project_hint") or "").strip(),
        "minutes": seconds // 60,
    }


async def generate_morning_brief(conn: Any, api_key: str) -> str:
    signals = collect_morning_signals(conn)
    prompt = build_morning_brief_prompt(signals)
    text = (
        await call_claude(
            prompt,
            api_key=api_key,
            model=SONNET_MODEL,
            max_tokens=320,
            temperature=0.4,
        )
    ).strip()
    if text and signals.get("discovery_gap_category"):
        mark_discovery_gap_asked(conn, signals["discovery_gap_category"])
        mark_gaps_asked_in_response(conn, text)
    return text


async def generate_observer_nudge(conn: Any, api_key: str) -> tuple[bool, str]:
    if _observer_nudge_cooldown_active(conn):
        return False, ""

    session = _longest_recent_app_session(conn, minutes=60)
    if session is None:
        return False, ""

    project_part = f" · {session['project']}" if session.get("project") else ""
    prompt = _OBSERVER_NUDGE_PROMPT.format(
        minutes=session["minutes"],
        app=session["app"],
        project_part=project_part,
    )
    try:
        content = (
            await call_claude(
                prompt,
                api_key=api_key,
                model=DEFAULT_MODEL,
                max_tokens=120,
                temperature=0.5,
            )
        ).strip()
    except Exception:
        logger.exception("observer-nudge: LLM call failed")
        return False, ""

    if not content:
        return False, ""

    set_meta(conn, "observer_nudge_last_at", datetime.now().isoformat())
    return True, content
