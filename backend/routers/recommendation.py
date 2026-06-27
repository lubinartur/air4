"""GET /api/air4/recommendation — single "what to do now" call from AIR4.

Reads a compact slice of the user's state (recent transactions, active
projects, recent workouts, profile, facts), asks Claude Haiku for ONE
opinionated recommendation, and returns it as structured JSON. The
result is cached in-memory for 30 minutes so repeated Overview loads
don't re-hit the LLM on every navigation.
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel

from database import fetch_all, fetch_one, get_db
from services.llm_client import parse_json_object
from services.llm_client_shared import call_claude
from services.prompts import get_subscriptions_context
from services.summary_loader import load_summary

router = APIRouter()

logger = logging.getLogger("recommendation")

_PROFILE_ID = 1
_CACHE_TTL_SECONDS = 30 * 60

# Simple in-process cache: {"data": Recommendation, "expires_at": float}.
# Intentionally a plain dict (no redis) — a single recommendation shared
# across the one local user is all this endpoint serves.
_cache: dict[str, Any] = {}
_domain_cache: dict[str, dict[str, Any]] = {}

Domain = Literal["finance", "projects", "health"]
_DOMAINS: tuple[Domain, ...] = ("finance", "projects", "health")
_DOMAIN_TITLES: dict[Domain, str] = {
    "finance": "Финансы",
    "projects": "Проекты",
    "health": "Спорт",
}

State = Literal["stable", "attention", "critical"]
_VALID_STATES = {"stable", "attention", "critical"}

# --- AIR4 engagement mode -------------------------------------------------
# Single source of truth for the mode → prompt-instruction mapping. Both
# this router and chat.py read the persisted `user_profile.air4_mode` and
# append the matching instruction to their system prompt. `normal` is the
# default and intentionally adds nothing (preserves existing behavior).

DEFAULT_AIR4_MODE = "normal"
VALID_AIR4_MODES = ("quiet", "normal", "active", "jarvis")

AIR4_MODE_INSTRUCTIONS: dict[str, str] = {
    "quiet": (
        "РЕЖИМ ВЗАИМОДЕЙСТВИЯ — ТИХИЙ:\n"
        "Отвечай только на прямые вопросы. Не инициируй. Короткие ответы."
    ),
    "normal": "",
    "active": (
        "РЕЖИМ ВЗАИМОДЕЙСТВИЯ — АКТИВНЫЙ:\n"
        "Будь проактивен. Задавай уточняющие вопросы. "
        "Предлагай следующий шаг после каждого ответа."
    ),
    "jarvis": (
        "РЕЖИМ ВЗАИМОДЕЙСТВИЯ — JARVIS:\n"
        "Ты со-пилот, не ассистент. У тебя есть мнение — говори его прямо.\n"
        "Всегда предлагай один конкретный следующий шаг.\n"
        "Помни контекст предыдущих разговоров.\n"
        "Раз в сессию задай один вопрос чтобы лучше понять пользователя.\n"
        "Не жди вопроса — если видишь важное, скажи сам."
    ),
}


def normalize_air4_mode(value: Any) -> str:
    """Coerce arbitrary input to a valid mode, defaulting to `normal`."""
    mode = str(value or "").strip().lower()
    return mode if mode in VALID_AIR4_MODES else DEFAULT_AIR4_MODE


def read_air4_mode(conn: Any) -> str:
    """Read the persisted AIR4 mode from user_profile (row id = 1).

    Uses `SELECT *` so it can't raise on databases where the migration
    hasn't added the column yet — falls back to the default in that case.
    """
    row = fetch_one(conn, "SELECT * FROM user_profile WHERE id = ?", (_PROFILE_ID,))
    return normalize_air4_mode(row.get("air4_mode") if row else None)


def air4_mode_instruction(mode: Any) -> str:
    """Prompt suffix for a mode. Empty string for `normal`/unknown."""
    return AIR4_MODE_INSTRUCTIONS.get(normalize_air4_mode(mode), "")


class Recommendation(BaseModel):
    recommendation: str
    basis: str
    state: State


class DomainRecommendation(BaseModel):
    domain: Domain
    title: str
    summary: str
    action: str
    generated_at: str


class DomainRecommendationsOut(BaseModel):
    finance: DomainRecommendation
    projects: DomainRecommendation
    health: DomainRecommendation


class ModeOut(BaseModel):
    mode: str


class ModeIn(BaseModel):
    mode: str


_PROMPT_TEMPLATE = (
    "Ты AIR4. На основе данных пользователя сформулируй ОДНУ главную рекомендацию "
    "для блока AIRCH Intelligence на экране Обзор.\n"
    "Не вопрос — мнение с конкретным следующим шагом. Прямо, без воды.\n\n"
    "Структура recommendation (4 предложения): факт → почему важно → рекомендация → "
    "одно действие сегодня. Язык: русский, на «ты», с цифрами когда есть.\n"
    'Формат ответа JSON: {{"recommendation": string, "basis": string, "state": "stable"|"attention"|"critical"}}\n'
    "recommendation — полный текст по структуре выше (4 предложения). "
    "basis — одна короткая строка: на каких данных основан совет (цифры/сферы). "
    "state — общее состояние: stable (всё ок), attention (есть на что обратить внимание), critical (есть проблема).\n"
    "Отвечай только JSON, без markdown.\n"
    "Данные: {context}"
)

_DOMAIN_PROMPT_TEMPLATE = (
    "Ты AIR4. Сфокусируйся на сфере «{domain}» и дай рекомендацию для экрана Обзор.\n"
    "Не вопрос — мнение с конкретным следующим шагом. Прямо, без воды.\n\n"
    "summary — 2-3 предложения максимум: что происходит (факт с цифрами) + почему важно + "
    "что рекомендую. Не перечисляй проблемы — предлагай решение.\n"
    "action — ровно 1 предложение: конкретное действие, выполнимое сегодня.\n"
    "Язык: русский, обращение на «ты». Будь конкретен с цифрами когда они есть в данных.\n\n"
    'Формат ответа JSON: {{"summary": string, "action": string}}\n'
    "Отвечай только JSON, без markdown.\n"
    "Данные: {context}"
)


def _format_profile(profile: dict[str, Any] | None) -> str:
    if not profile:
        return "Профиль: пусто."
    parts: list[str] = []
    for label, key in (
        ("Имя", "name"),
        ("Город", "city"),
        ("Профессия", "profession"),
        ("Доход/мес", "monthly_income"),
        ("Цели", "goals"),
    ):
        val = profile.get(key)
        if val is not None and str(val).strip():
            parts.append(f"{label}: {val}")
    return "Профиль: " + ("; ".join(parts) if parts else "пусто")


def _build_context(conn: Any) -> str:
    """Compact, ~<800 token snapshot of the user's current state."""
    profile = fetch_one(
        conn, "SELECT * FROM user_profile WHERE id = ?", (_PROFILE_ID,)
    )

    facts = fetch_all(
        conn,
        """
        SELECT key, value
        FROM user_facts
        ORDER BY confidence DESC, datetime(updated_at) DESC, id DESC
        LIMIT 12
        """,
    )

    transactions = fetch_all(
        conn,
        """
        SELECT date, description, amount, category
        FROM transactions
        WHERE COALESCE(is_internal_transfer, 0) = 0
        ORDER BY date DESC, id DESC
        LIMIT 15
        """,
    )

    projects = fetch_all(
        conn,
        """
        SELECT name, status, updated_at
        FROM projects
        WHERE status = 'active'
        ORDER BY datetime(updated_at) DESC
        LIMIT 8
        """,
    )

    workouts = fetch_all(
        conn,
        """
        SELECT date, type, duration
        FROM workouts
        ORDER BY date DESC, id DESC
        LIMIT 5
        """,
    )

    lines: list[str] = [_format_profile(profile)]

    if facts:
        fact_str = "; ".join(
            f"{f.get('key')}={f.get('value')}" for f in facts if f.get("key")
        )
        lines.append(f"Факты: {fact_str}")

    if transactions:
        tx_str = "; ".join(
            f"{t.get('date')} {t.get('description') or ''} "
            f"{t.get('amount')}€ [{t.get('category') or '—'}]".strip()
            for t in transactions
        )
        lines.append(f"Последние транзакции: {tx_str}")
    else:
        lines.append("Последние транзакции: нет данных.")

    if projects:
        pr_str = "; ".join(
            f"{p.get('name')} (обновлён {p.get('updated_at')})" for p in projects
        )
        lines.append(f"Активные проекты: {pr_str}")
    else:
        lines.append("Активные проекты: нет.")

    if workouts:
        w_str = "; ".join(
            f"{w.get('date')} {w.get('type') or 'тренировка'}" for w in workouts
        )
        lines.append(f"Последние тренировки: {w_str}")
    else:
        lines.append("Последние тренировки: нет данных.")

    context = "\n".join(lines)
    # Rough guard so we never blow past the ~800-token budget: clip at
    # ~3200 chars (≈800 tokens for mixed RU/EN text).
    if len(context) > 3200:
        context = context[:3200]
    return context


def _clip_context(text: str, limit: int = 3200) -> str:
    return text if len(text) <= limit else text[:limit]


def _build_finance_context(conn: Any) -> str:
    """Spending summary, subscriptions, obligations, savings signals."""
    profile = fetch_one(conn, "SELECT * FROM user_profile WHERE id = ?", (_PROFILE_ID,))
    summary = load_summary(conn)
    lines: list[str] = [_format_profile(profile)]

    period_start = getattr(summary, "period_start", None)
    period_end = getattr(summary, "period_end", None)
    total_spent = float(getattr(summary, "total_spent", 0) or 0)
    total_income = float(getattr(summary, "total_income", 0) or 0)
    other = getattr(summary, "other_incoming", None)
    other_amt = float(getattr(other, "amount", 0) or 0) if other else 0.0
    income = total_income + other_amt
    free = income - total_spent

    if period_start or period_end:
        lines.append(f"Период: {period_start or '?'} — {period_end or '?'}")
    lines.append(f"Потрачено: €{total_spent:.2f}; получено: €{income:.2f}; свободно: €{free:.2f}")

    forecast = float(getattr(summary, "forecast_end_of_cycle", 0) or 0)
    daily_rate = float(getattr(summary, "daily_spend_rate", 0) or 0)
    if daily_rate > 0:
        lines.append(
            f"Темп: €{daily_rate:.2f}/день; прогноз на конец цикла: €{forecast:.2f}"
        )

    by_category = getattr(summary, "by_category", None) or {}
    if by_category:
        cat_parts: list[str] = []
        sorted_cats = sorted(
            by_category.items(),
            key=lambda item: float(
                item[1].get("amount", 0)
                if isinstance(item[1], dict)
                else getattr(item[1], "amount", 0) or 0
            ),
            reverse=True,
        )
        for category, data in sorted_cats[:6]:
            amount = float(
                data.get("amount", 0) if isinstance(data, dict) else getattr(data, "amount", 0) or 0
            )
            cat_parts.append(f"{category}: €{amount:.2f}")
        lines.append("По категориям: " + "; ".join(cat_parts))

    subs_text = get_subscriptions_context(conn).strip()
    if subs_text:
        lines.append(subs_text)

    obligations = fetch_all(
        conn,
        """
        SELECT name, monthly_payment, remaining_amount, total_amount, category
        FROM obligations
        WHERE COALESCE(is_active, 1) = 1
        ORDER BY COALESCE(monthly_payment, 0) DESC, name ASC
        LIMIT 10
        """,
    )
    if obligations:
        ob_parts = []
        monthly_total = 0.0
        for ob in obligations:
            name = str(ob.get("name") or "?").strip()
            monthly = ob.get("monthly_payment")
            remaining = ob.get("remaining_amount")
            monthly_val = float(monthly) if isinstance(monthly, (int, float)) else 0.0
            monthly_total += monthly_val
            rem_part = (
                f", остаток €{float(remaining):.0f}"
                if isinstance(remaining, (int, float))
                else ""
            )
            pay_part = (
                f"€{monthly_val:.0f}/мес{rem_part}"
                if monthly_val > 0
                else rem_part.lstrip(", ") or "сумма неизвестна"
            )
            ob_parts.append(f"{name}: {pay_part}")
        lines.append("Обязательства: " + "; ".join(ob_parts))
        if monthly_total > 0:
            lines.append(f"Итого обязательств/мес: €{monthly_total:.2f}")
    else:
        lines.append("Обязательства: нет данных.")

    savings_facts = fetch_all(
        conn,
        """
        SELECT key, value
        FROM user_facts
        WHERE LOWER(key) LIKE '%reserve%'
           OR LOWER(key) LIKE '%saving%'
           OR LOWER(key) LIKE '%резерв%'
           OR LOWER(key) LIKE '%накоп%'
           OR LOWER(key) LIKE '%фонд%'
        ORDER BY datetime(updated_at) DESC, id DESC
        LIMIT 6
        """,
    )
    if savings_facts:
        lines.append(
            "Накопления/резерв: "
            + "; ".join(f"{f.get('key')}={f.get('value')}" for f in savings_facts)
        )

    transactions = fetch_all(
        conn,
        """
        SELECT date, description, amount, category
        FROM transactions
        WHERE COALESCE(is_internal_transfer, 0) = 0
        ORDER BY date DESC, id DESC
        LIMIT 10
        """,
    )
    if transactions:
        tx_str = "; ".join(
            f"{t.get('date')} {t.get('description') or ''} "
            f"{t.get('amount')}€ [{t.get('category') or '—'}]".strip()
            for t in transactions
        )
        lines.append(f"Последние транзакции: {tx_str}")

    return _clip_context("\n".join(lines))


def _build_projects_context(conn: Any) -> str:
    """Active projects, momentum, days inactive."""
    profile = fetch_one(conn, "SELECT * FROM user_profile WHERE id = ?", (_PROFILE_ID,))
    lines: list[str] = [_format_profile(profile)]

    projects = fetch_all(
        conn,
        """
        SELECT id, name, status, updated_at, created_at
        FROM projects
        WHERE status IN ('active', 'stalled')
        ORDER BY datetime(updated_at) DESC
        LIMIT 12
        """,
    )
    if not projects:
        lines.append("Активные проекты: нет.")
        return _clip_context("\n".join(lines))

    today = datetime.now(timezone.utc).date()
    project_parts: list[str] = []
    for project in projects:
        name = str(project.get("name") or "?").strip()
        updated_raw = str(project.get("updated_at") or "")[:10]
        days_inactive = "?"
        try:
            updated_d = datetime.strptime(updated_raw, "%Y-%m-%d").date()
            days_inactive = str(max(0, (today - updated_d).days))
        except ValueError:
            pass
        pid = int(project.get("id") or 0)
        log_row = fetch_one(
            conn,
            """
            SELECT COUNT(*) AS n,
                   MAX(datetime(created_at)) AS last_log
            FROM project_logs
            WHERE project_id = ?
              AND datetime(created_at) >= datetime('now', '-14 days')
            """,
            (pid,),
        )
        logs_14d = int(log_row.get("n") or 0) if log_row else 0
        last_log = log_row.get("last_log") if log_row else None
        project_parts.append(
            f"«{name}» — {days_inactive} дн без обновления, "
            f"{logs_14d} записей за 14 дн"
            + (f", последняя {last_log}" if last_log else "")
        )
    lines.append("Проекты: " + "; ".join(project_parts))

    recent_logs = fetch_all(
        conn,
        """
        SELECT p.name, pl.log_type, pl.created_at
        FROM project_logs pl
        JOIN projects p ON p.id = pl.project_id
        ORDER BY datetime(pl.created_at) DESC
        LIMIT 8
        """,
    )
    if recent_logs:
        log_parts = [
            f"{r.get('created_at')} «{r.get('name')}» [{r.get('log_type') or 'log'}]"
            for r in recent_logs
        ]
        lines.append("Последняя активность: " + "; ".join(log_parts))

    return _clip_context("\n".join(lines))


def _build_health_context(conn: Any) -> str:
    """Workouts last 7 days, body metrics, health markers."""
    profile = fetch_one(conn, "SELECT * FROM user_profile WHERE id = ?", (_PROFILE_ID,))
    lines: list[str] = [_format_profile(profile)]

    workouts = fetch_all(
        conn,
        """
        SELECT date, type, duration
        FROM workouts
        WHERE date >= date('now', '-7 days')
        ORDER BY date DESC, id DESC
        """,
    )
    if workouts:
        w_str = "; ".join(
            f"{w.get('date')} {w.get('type') or 'тренировка'}"
            + (f" {w.get('duration')} мин" if w.get("duration") else "")
            for w in workouts
        )
        lines.append(f"Тренировки за 7 дней ({len(workouts)}): {w_str}")
    else:
        all_workouts = fetch_all(
            conn,
            """
            SELECT date, type, duration
            FROM workouts
            ORDER BY date DESC, id DESC
            LIMIT 3
            """,
        )
        if all_workouts:
            last = all_workouts[0]
            lines.append(
                f"За 7 дней тренировок нет. Последняя: {last.get('date')} "
                f"{last.get('type') or '—'}"
            )
        else:
            lines.append("Тренировки: нет данных.")

    metrics = fetch_all(
        conn,
        """
        SELECT date, weight, height, body_fat, notes
        FROM body_metrics
        ORDER BY date DESC, id DESC
        LIMIT 5
        """,
    )
    if metrics:
        metric_parts: list[str] = []
        for m in metrics:
            parts = [str(m.get("date") or "?")]
            if m.get("weight") is not None:
                parts.append(f"вес {m.get('weight')} кг")
            if m.get("body_fat") is not None:
                parts.append(f"жир {m.get('body_fat')}%")
            if m.get("notes"):
                parts.append(str(m.get("notes"))[:60])
            metric_parts.append(", ".join(parts))
        lines.append("Метрики тела: " + "; ".join(metric_parts))

    checkups = fetch_all(
        conn,
        """
        SELECT date, marker_name, value, unit, status
        FROM health_checkups
        WHERE status IN ('HIGH', 'LOW')
        ORDER BY date DESC, status, marker_name
        LIMIT 8
        """,
    )
    if checkups:
        marker_parts = [
            f"{c.get('date')} {c.get('marker_name')}={c.get('value')}{c.get('unit') or ''} "
            f"({c.get('status')})"
            for c in checkups
        ]
        lines.append("Маркеры вне нормы: " + "; ".join(marker_parts))

    energy_facts = fetch_all(
        conn,
        """
        SELECT key, value
        FROM user_facts
        WHERE LOWER(key) LIKE '%energy%'
           OR LOWER(key) LIKE '%sleep%'
           OR LOWER(key) LIKE '%энерг%'
           OR LOWER(key) LIKE '%сон%'
           OR LOWER(key) LIKE '%устал%'
        ORDER BY datetime(updated_at) DESC, id DESC
        LIMIT 5
        """,
    )
    if energy_facts:
        lines.append(
            "Энергия/сон: "
            + "; ".join(f"{f.get('key')}={f.get('value')}" for f in energy_facts)
        )

    return _clip_context("\n".join(lines))


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _coerce_domain_recommendation(
    domain: Domain, raw: dict[str, Any] | None
) -> DomainRecommendation:
    summary = str((raw or {}).get("summary") or "").strip()
    action = str((raw or {}).get("action") or "").strip()
    if not summary:
        summary = _domain_fallback_summary(domain)
    if not action:
        action = _domain_fallback_action(domain)
    return DomainRecommendation(
        domain=domain,
        title=_DOMAIN_TITLES[domain],
        summary=summary,
        action=action,
        generated_at=_now_iso(),
    )


def _domain_fallback_summary(domain: Domain) -> str:
    fallbacks = {
        "finance": (
            "Пока мало финансовых данных — без выписок и обязательств совет будет общим. "
            "Загрузи транзакции или добавь подписки, чтобы я видел реальную картину."
        ),
        "projects": (
            "Активных проектов не видно или они давно без движения. "
            "Без логов и обновлений сложно понять, где теряется импульс."
        ),
        "health": (
            "За последнюю неделю тренировок и метрик почти нет — картина пустая. "
            "Без данных я не смогу поймать паттерны энергии и восстановления."
        ),
    }
    return fallbacks[domain]


def _domain_fallback_action(domain: Domain) -> str:
    actions = {
        "finance": "Сегодня: загрузи выписку или добавь одну подписку/обязательство вручную.",
        "projects": "Сегодня: открой один проект и запиши следующий шаг на 30 минут.",
        "health": "Сегодня: запиши одну тренировку или вес — даже короткая прогулка считается.",
    }
    return actions[domain]


async def _generate_domain_recommendation(
    domain: Domain, context: str, mode: str
) -> DomainRecommendation:
    now = time.time()
    cached = _domain_cache.get(domain)
    if cached is not None and now < cached.get("expires_at", 0.0):
        return cached["data"]  # type: ignore[return-value]

    prompt = _DOMAIN_PROMPT_TEMPLATE.format(domain=_DOMAIN_TITLES[domain], context=context)
    mode_suffix = air4_mode_instruction(mode)
    if mode_suffix:
        prompt = f"{prompt}\n\n{mode_suffix}"

    try:
        raw_text = await call_claude(prompt, max_tokens=512)
    except Exception:
        logger.exception("recommendation: domain %s LLM call failed", domain)
        raw_text = ""

    if not raw_text.strip():
        result = _coerce_domain_recommendation(domain, None)
    else:
        parsed = parse_json_object(raw_text)
        result = _coerce_domain_recommendation(domain, parsed)

    _domain_cache[domain] = {"data": result, "expires_at": now + _CACHE_TTL_SECONDS}
    return result


def _coerce_recommendation(raw: dict[str, Any]) -> Recommendation:
    recommendation = str(raw.get("recommendation") or "").strip()
    basis = str(raw.get("basis") or "").strip()
    state = str(raw.get("state") or "").strip().lower()
    if state not in _VALID_STATES:
        state = "stable"
    if not recommendation:
        recommendation = (
            "Пока мало данных для точной картины — вижу только базовый профиль. "
            "Без транзакций, проектов или тренировок любой совет будет общим и бесполезным. "
            "Я бы начал с одной сферы: загрузи выписку или заведи один активный проект. "
            "Сегодня: добавь хотя бы одну транзакцию или запиши одну тренировку вручную."
        )
    return Recommendation(recommendation=recommendation, basis=basis, state=state)  # type: ignore[arg-type]


def _fallback() -> Recommendation:
    return Recommendation(
        recommendation=(
            "Пока мало данных для точной картины — вижу только базовый профиль. "
            "Без транзакций, проектов или тренировок любой совет будет общим и бесполезным. "
            "Я бы начал с одной сферы: загрузи выписку или заведи один активный проект. "
            "Сегодня: добавь хотя бы одну транзакцию или запиши одну тренировку вручную."
        ),
        basis="Недостаточно данных или модель недоступна.",
        state="stable",
    )


@router.get("/recommendation", response_model=Recommendation)
async def get_recommendation() -> Recommendation:
    now = time.time()
    cached = _cache.get("data")
    expires_at = _cache.get("expires_at", 0.0)
    if cached is not None and now < expires_at:
        return cached  # type: ignore[return-value]

    with get_db() as conn:
        context = _build_context(conn)
        mode = read_air4_mode(conn)

    prompt = _PROMPT_TEMPLATE.format(context=context)
    mode_suffix = air4_mode_instruction(mode)
    if mode_suffix:
        prompt = f"{prompt}\n\n{mode_suffix}"

    try:
        raw_text = await call_claude(prompt, max_tokens=768)
    except Exception:
        logger.exception("recommendation: LLM call failed")
        raw_text = ""

    if not raw_text.strip():
        result = _fallback()
    else:
        parsed = parse_json_object(raw_text)
        result = _coerce_recommendation(parsed) if parsed else _fallback()

    _cache["data"] = result
    _cache["expires_at"] = now + _CACHE_TTL_SECONDS
    return result


@router.get("/recommendations", response_model=DomainRecommendationsOut)
async def get_domain_recommendations() -> DomainRecommendationsOut:
    """Three domain-specific recommendations for the Overview AIRCH block."""
    with get_db() as conn:
        mode = read_air4_mode(conn)
        finance_ctx = _build_finance_context(conn)
        projects_ctx = _build_projects_context(conn)
        health_ctx = _build_health_context(conn)

    finance, projects, health = await asyncio.gather(
        _generate_domain_recommendation("finance", finance_ctx, mode),
        _generate_domain_recommendation("projects", projects_ctx, mode),
        _generate_domain_recommendation("health", health_ctx, mode),
    )
    return DomainRecommendationsOut(
        finance=finance,
        projects=projects,
        health=health,
    )


@router.get("/mode", response_model=ModeOut)
def get_mode() -> ModeOut:
    """Current AIR4 engagement mode persisted on user_profile."""
    with get_db() as conn:
        return ModeOut(mode=read_air4_mode(conn))


@router.put("/mode", response_model=ModeOut)
def set_mode(body: ModeIn) -> ModeOut:
    """Persist a new AIR4 engagement mode.

    Invalid values are coerced to `normal`. Clears the recommendation
    cache so the next /recommendation reflects the new mode immediately
    instead of waiting out the 30-minute TTL.
    """
    mode = normalize_air4_mode(body.mode)
    with get_db() as conn:
        conn.execute(
            "UPDATE user_profile SET air4_mode = ?, updated_at = datetime('now') "
            "WHERE id = ?",
            (mode, _PROFILE_ID),
        )
        conn.commit()
    _cache.clear()
    _domain_cache.clear()
    return ModeOut(mode=mode)
