"""GET /api/air4/recommendation — single "what to do now" call from AIR4.

Reads a compact slice of the user's state (recent transactions, active
projects, recent workouts, profile, facts), asks Claude Haiku for ONE
opinionated recommendation, and returns it as structured JSON. The
result is cached in-memory for 30 minutes so repeated Overview loads
don't re-hit the LLM on every navigation.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel

from database import fetch_all, fetch_one, get_db
from services.llm_client import parse_json_object
from services.llm_client_shared import call_claude

router = APIRouter()

logger = logging.getLogger("recommendation")

_PROFILE_ID = 1
_CACHE_TTL_SECONDS = 30 * 60

# Simple in-process cache: {"data": Recommendation, "expires_at": float}.
# Intentionally a plain dict (no redis) — a single recommendation shared
# across the one local user is all this endpoint serves.
_cache: dict[str, Any] = {}

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


class ModeOut(BaseModel):
    mode: str


class ModeIn(BaseModel):
    mode: str


_PROMPT_TEMPLATE = (
    "Ты AIR4. На основе данных пользователя дай ОДНУ главную рекомендацию что делать прямо сейчас.\n"
    "Не вопрос — мнение. Максимум 2-3 предложения. Прямо, без воды.\n"
    'Формат ответа JSON: {{"recommendation": string, "basis": string, "state": "stable"|"attention"|"critical"}}\n'
    "recommendation — сам совет. basis — на чём он основан (коротко). "
    "state — общее состояние: stable (всё ок), attention (есть на что обратить внимание), critical (есть проблема).\n"
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


def _coerce_recommendation(raw: dict[str, Any]) -> Recommendation:
    recommendation = str(raw.get("recommendation") or "").strip()
    basis = str(raw.get("basis") or "").strip()
    state = str(raw.get("state") or "").strip().lower()
    if state not in _VALID_STATES:
        state = "stable"
    if not recommendation:
        recommendation = "Пока недостаточно данных для конкретного совета."
    return Recommendation(recommendation=recommendation, basis=basis, state=state)  # type: ignore[arg-type]


def _fallback() -> Recommendation:
    return Recommendation(
        recommendation="Пока недостаточно данных, чтобы дать точную рекомендацию. "
        "Добавь транзакции, проекты или тренировки — и я подскажу, на чём сфокусироваться.",
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
        raw_text = await call_claude(prompt, max_tokens=512)
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
    return ModeOut(mode=mode)
