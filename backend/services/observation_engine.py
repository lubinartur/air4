from __future__ import annotations

import json
import logging
from datetime import date
from typing import Any

from database import execute, fetch_all, fetch_one
from services.llm_client import parse_json_array
from services.llm_client_shared import DEFAULT_MODEL, call_claude

logger = logging.getLogger("observation_engine")

SPIKE_THRESHOLD = 1.5  # >50% vs previous period
PROJECT_STALL_DAYS = 7
NO_WORKOUT_DAYS = 10
WORKOUT_STREAK_MIN = 3
WORKOUT_STREAK_WINDOW_DAYS = 7
COOLDOWN_DAYS = 7

VALID_OBSERVATION_TYPES = frozenset(
    {
        "spending_spike",
        "project_stalled",
        "stalled_project",
        "no_workout",
        "workout_streak",
        "inactivity",
        "cross_sphere",
        "cross_domain",
        "streak_break",
        "positive",
    }
)

_TYPE_ALIASES = {
    "stalled_project": "project_stalled",
    "inactivity": "no_workout",
    "cross_domain": "cross_sphere",
}


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    s = str(value).strip()[:10]
    try:
        return date.fromisoformat(s)
    except ValueError:
        return None


def _days_since(value: str | None) -> int | None:
    d = _parse_date(value)
    if d is None:
        return None
    return (date.today() - d).days


def _pct_growth(current: float, previous: float) -> float | None:
    if previous <= 0:
        return None
    return round((current - previous) / previous * 100, 1)


def _load_spending_by_period(db: Any) -> dict[str, Any]:
    current_rows = fetch_all(
        db,
        """
        SELECT COALESCE(category, 'uncategorized') AS category,
               ROUND(COALESCE(SUM(amount), 0), 2) AS total
        FROM transactions
        WHERE COALESCE(is_debit, 0) = 1
          AND COALESCE(is_internal_transfer, 0) = 0
          AND date >= date('now', '-30 days')
          AND date <= date('now')
        GROUP BY category
        """,
    )
    previous_rows = fetch_all(
        db,
        """
        SELECT COALESCE(category, 'uncategorized') AS category,
               ROUND(COALESCE(SUM(amount), 0), 2) AS total
        FROM transactions
        WHERE COALESCE(is_debit, 0) = 1
          AND COALESCE(is_internal_transfer, 0) = 0
          AND date >= date('now', '-60 days')
          AND date < date('now', '-30 days')
        GROUP BY category
        """,
    )
    current = {r["category"]: float(r["total"] or 0) for r in current_rows}
    previous = {r["category"]: float(r["total"] or 0) for r in previous_rows}
    categories: list[dict[str, Any]] = []
    all_keys = set(current) | set(previous)
    for cat in sorted(all_keys):
        cur = current.get(cat, 0.0)
        prev = previous.get(cat, 0.0)
        ratio = (cur / prev) if prev > 0 else None
        categories.append(
            {
                "category": cat,
                "current_30d": cur,
                "previous_30d": prev,
                "growth_pct": _pct_growth(cur, prev),
                "spike": prev > 0 and cur >= prev * SPIKE_THRESHOLD,
            }
        )
    return {
        "current_period": "last_30_days",
        "previous_period": "prior_30_days",
        "by_category": categories,
    }


def _load_recent_events(db: Any) -> list[dict[str, Any]]:
    return fetch_all(
        db,
        """
        SELECT id, date, title, description, domain, category, importance, created_at
        FROM events
        WHERE COALESCE(archived, 0) = 0
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT 10
        """,
    )


def _load_active_projects(db: Any) -> list[dict[str, Any]]:
    rows = fetch_all(
        db,
        """
        SELECT p.id, p.name, p.status, p.created_at, p.updated_at,
               (
                 SELECT MAX(pl.created_at)
                 FROM project_logs pl
                 WHERE pl.project_id = p.id
               ) AS last_log_at
        FROM projects p
        WHERE p.status = 'active'
        ORDER BY datetime(p.updated_at) DESC, p.id DESC
        """,
    )
    out: list[dict[str, Any]] = []
    for row in rows:
        last_activity = row.get("last_log_at") or row.get("updated_at") or row.get(
            "created_at"
        )
        days_inactive = _days_since(str(last_activity) if last_activity else None)
        out.append(
            {
                "id": row["id"],
                "name": row["name"],
                "status": row["status"],
                "last_activity": last_activity,
                "days_inactive": days_inactive,
            }
        )
    return out


def _load_last_workout_date(db: Any) -> str | None:
    row = fetch_one(
        db,
        """
        SELECT MAX(date) AS last_date
        FROM workouts
        """,
    )
    if not row or not row.get("last_date"):
        return None
    return str(row["last_date"])[:10]


def _count_workouts_last_n_days(db: Any, days: int) -> int:
    row = fetch_one(
        db,
        """
        SELECT COUNT(*) AS n
        FROM workouts
        WHERE date >= date('now', ?)
          AND date <= date('now')
        """,
        (f"-{days} days",),
    )
    if not row:
        return 0
    try:
        return int(row.get("n") or 0)
    except (TypeError, ValueError):
        return 0


def _load_recent_workouts(db: Any, limit: int = 5) -> list[dict[str, Any]]:
    rows = fetch_all(
        db,
        """
        SELECT date, type, duration, exercises
        FROM workouts
        ORDER BY date DESC, id DESC
        LIMIT ?
        """,
        (limit,),
    )
    out: list[dict[str, Any]] = []
    for row in rows:
        exercises = row.get("exercises")
        if isinstance(exercises, str) and exercises.strip():
            try:
                exercises = json.loads(exercises)
            except json.JSONDecodeError:
                pass
        out.append(
            {
                "date": row.get("date"),
                "type": row.get("type"),
                "duration": row.get("duration"),
                "exercises": exercises,
            }
        )
    return out


def _load_user_facts(db: Any) -> list[dict[str, Any]]:
    return fetch_all(
        db,
        """
        SELECT key, value, confidence, source, updated_at
        FROM user_facts
        WHERE confidence >= 0.6
        ORDER BY confidence DESC, key ASC
        """,
    )


def _run_rule_layer(
    spending: dict[str, Any],
    projects: list[dict[str, Any]],
    last_workout_date: str | None,
    workouts_last_7d: int,
) -> list[dict[str, Any]]:
    signals: list[dict[str, Any]] = []

    for row in spending.get("by_category") or []:
        if not row.get("spike"):
            continue
        signals.append(
            {
                "signal": "spending_spike",
                "observation_type": "spending_spike",
                "category": row["category"],
                "current_30d": row["current_30d"],
                "previous_30d": row["previous_30d"],
                "growth_pct": row["growth_pct"],
                "domains": ["finance"],
            }
        )

    for project in projects:
        days = project.get("days_inactive")
        if days is None or days <= PROJECT_STALL_DAYS:
            continue
        signals.append(
            {
                "signal": "project_stalled",
                "observation_type": "project_stalled",
                "project_id": project["id"],
                "project_name": project["name"],
                "days_inactive": days,
                "last_activity": project.get("last_activity"),
                "domains": ["projects"],
            }
        )

    has_workout_streak = workouts_last_7d >= WORKOUT_STREAK_MIN
    if has_workout_streak:
        signals.append(
            {
                "signal": "workout_streak",
                "observation_type": "workout_streak",
                "workouts_last_7d": workouts_last_7d,
                "window_days": WORKOUT_STREAK_WINDOW_DAYS,
                "domains": ["health"],
            }
        )

    if not has_workout_streak:
        if last_workout_date:
            days_without = _days_since(last_workout_date) or 0
        else:
            days_without = NO_WORKOUT_DAYS + 1

        if days_without >= NO_WORKOUT_DAYS:
            signals.append(
                {
                    "signal": "no_workout",
                    "observation_type": "no_workout",
                    "days_without_workout": days_without,
                    "last_workout_date": last_workout_date,
                    "domains": ["health"],
                }
            )

    has_spike = any(s["signal"] == "spending_spike" for s in signals)
    has_stalled = any(s["signal"] == "project_stalled" for s in signals)
    if has_spike and has_stalled:
        spike = next(s for s in signals if s["signal"] == "spending_spike")
        stalled = [s for s in signals if s["signal"] == "project_stalled"]
        signals.append(
            {
                "signal": "cross_sphere",
                "observation_type": "cross_sphere",
                "spending_spike": {
                    "category": spike.get("category"),
                    "growth_pct": spike.get("growth_pct"),
                    "current_30d": spike.get("current_30d"),
                },
                "stalled_projects": [
                    {
                        "name": s.get("project_name"),
                        "days_inactive": s.get("days_inactive"),
                    }
                    for s in stalled
                ],
                "domains": ["finance", "projects"],
            }
        )

    return signals


def _build_llm_prompt(context: dict[str, Any], signals: list[dict[str, Any]]) -> str:
    return (
        "Ты фильтр и редактор наблюдений для AIR4 — личного советника.\n\n"
        "Сигналы rule layer:\n"
        f"{json.dumps(signals, ensure_ascii=False, indent=2)}\n\n"
        "Контекст пользователя:\n"
        f"{json.dumps(context, ensure_ascii=False, indent=2)}\n\n"
        "ШАГ 1 — GATE CHECK (жёсткий фильтр):\n"
        "Для каждого сигнала спроси себя: скажет ли пользователь "
        '"чёрт… он прав, я бы сам не заметил"?\n\n'
        "ПРОПУСТИ если:\n"
        '- Пользователь знает это без AIR4 ("ты не тренировался" — он знает)\n'
        "- Нет конкретной цифры или неочевидной связи\n"
        "- Похожее наблюдение было недавно\n"
        "- Нет actionable вывода или вопроса\n\n"
        "ОТПРАВЬ если:\n"
        "- Есть неочевидная связь между двумя сферами\n"
        "- Есть конкретная цифра которая удивит\n"
        "- Есть паттерн который повторяется 2+ раза\n\n"
        "ШАГ 2 — ФОРМУЛИРОВКА:\n"
        "Структура: факт с цифрой → связь или паттерн → действие ИЛИ вопрос "
        "(не оба).\n"
        "Максимум 3 предложения. Язык зависит от confidence:\n"
        '- < 0.5: "Начинает выглядеть как..."\n'
        '- 0.5-0.7: "Похоже что..."\n'
        '- > 0.7: "Судя по последним N случаям..."\n\n'
        'Запрещено: "тебе следует", "попробуй", "рекомендую", выводы без цифр, '
        "морализаторство.\n\n"
        "Если ни один сигнал не прошёл Gate Check — верни []. "
        "Лучше молчать чем говорить банальность.\n\n"
        "Верни ТОЛЬКО JSON-массив без markdown:\n"
        "[{\n"
        '  "title": "короткий заголовок",\n'
        '  "body": "текст наблюдения",\n'
        '  "observation_type": "spending_spike|project_stalled|no_workout|workout_streak|cross_sphere",\n'
        '  "confidence": 0.0-1.0,\n'
        '  "domains_involved": ["finance", "projects", ...]\n'
        "}]"
    )


def _normalize_observation_type(raw: str) -> str:
    t = (raw or "").strip().lower()
    t = _TYPE_ALIASES.get(t, t)
    if t in VALID_OBSERVATION_TYPES:
        return t
    return "spending_spike"


def _on_cooldown(db: Any, observation_type: str) -> bool:
    row = fetch_one(
        db,
        """
        SELECT id FROM observations
        WHERE observation_type = ?
          AND datetime(created_at) >= datetime('now', ?)
        LIMIT 1
        """,
        (observation_type, f"-{COOLDOWN_DAYS} days"),
    )
    return row is not None


def _save_observation(db: Any, item: dict[str, Any]) -> dict[str, Any] | None:
    title = str(item.get("title") or "").strip()
    body = str(item.get("body") or "").strip()
    if not title or not body:
        return None

    observation_type = _normalize_observation_type(
        str(item.get("observation_type") or "")
    )
    if _on_cooldown(db, observation_type):
        logger.info(
            "Skipping observation type %s — cooldown %sd active",
            observation_type,
            COOLDOWN_DAYS,
        )
        return None

    try:
        confidence = float(item.get("confidence", 0.5))
    except (TypeError, ValueError):
        confidence = 0.5
    confidence = max(0.0, min(1.0, confidence))

    domains = item.get("domains_involved")
    if isinstance(domains, list):
        domains_json = json.dumps(domains, ensure_ascii=False)
    elif isinstance(domains, str) and domains.strip():
        domains_json = domains
    else:
        domains_json = json.dumps([], ensure_ascii=False)

    evidence_refs = json.dumps([], ensure_ascii=False)

    try:
        obs_id = execute(
            db,
            """
            INSERT INTO observations (
                title, body, observation_type, confidence,
                evidence_refs, domains_involved,
                triggered_by, is_hypothesis, is_read,
                expires_at, created_at
            )
            VALUES (
                ?, ?, ?, ?,
                ?, ?,
                'rule_layer', 1, 0,
                datetime('now', '+7 days'), datetime('now')
            )
            """,
            (
                title,
                body,
                observation_type,
                confidence,
                evidence_refs,
                domains_json,
            ),
        )
        row = fetch_one(db, "SELECT * FROM observations WHERE id = ?", (obs_id,))
        return dict(row) if row else None
    except Exception:
        logger.exception("Failed to save observation: %s", title)
        return None


async def generate_observations(db: Any, api_key: str) -> list[dict]:
    try:
        spending = _load_spending_by_period(db)
        events = _load_recent_events(db)
        projects = _load_active_projects(db)
        facts = _load_user_facts(db)
        last_workout_date = _load_last_workout_date(db)
        workouts_last_7d = _count_workouts_last_n_days(db, WORKOUT_STREAK_WINDOW_DAYS)
        recent_workouts = _load_recent_workouts(db, 5)

        signals = _run_rule_layer(
            spending, projects, last_workout_date, workouts_last_7d
        )
        if not signals:
            return []

        context = {
            "spending": spending,
            "recent_events": events,
            "active_projects": projects,
            "user_facts": facts,
            "recent_workouts": recent_workouts,
        }

        try:
            raw = await call_claude(
                _build_llm_prompt(context, signals),
                api_key=api_key,
                model=DEFAULT_MODEL,
                temperature=0.3,
            )
            drafts = parse_json_array(raw)
        except Exception:
            logger.exception("Claude observation generation failed")
            return []

        saved: list[dict] = []
        for item in drafts[:3]:
            if not isinstance(item, dict):
                continue
            row = _save_observation(db, item)
            if row is not None:
                saved.append(row)
        return saved
    except Exception:
        logger.exception("generate_observations failed")
        return []
