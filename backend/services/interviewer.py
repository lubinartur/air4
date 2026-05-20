from __future__ import annotations

import json
import logging
from typing import Any

from database import execute, fetch_all, fetch_one
from services.llm_client_shared import DEFAULT_MODEL, call_claude

logger = logging.getLogger("interviewer")

COOLDOWN_DAYS = 3
_PROFILE_ID = 1

# Темы и ключевые слова для поиска в user_facts (key + value).
# Порядок задаёт приоритет: первый незакрытый — самый важный пробел.
TOPICS: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "работа",
        (
            "work", "job", "profession", "career", "employer",
            "работ", "профес", "должност", "карьер",
        ),
    ),
    (
        "семья",
        (
            "family", "wife", "husband", "partner", "kids", "children",
            "семь", "жен", "муж", "девушк", "парн", "дет", "ребен",
        ),
    ),
    (
        "цели",
        (
            "goal", "target", "wish", "ambition", "plan",
            "цел", "хоч", "мечт",
        ),
    ),
    (
        "здоровье",
        (
            "health", "fitness", "workout", "sleep", "diet", "weight",
            "здоров", "тренир", "сон", "питан", "вес",
        ),
    ),
    (
        "хобби",
        (
            "hobby", "interest", "passion", "music", "sport", "travel",
            "хобби", "увлеч", "интерес", "музык", "путешеств",
        ),
    ),
    (
        "финансовые_привычки",
        (
            "spending", "saving", "income", "budget", "investment",
            "трат", "эконом", "доход", "бюджет", "инвест",
        ),
    ),
    (
        "планы_на_будущее",
        (
            "future", "plan", "dream", "next_year", "next_month",
            "будущ", "планир", "через год", "через месяц",
        ),
    ),
)


def _profile_text(profile: dict[str, Any] | None) -> str:
    if not profile:
        return ""
    parts: list[str] = []
    for k in ("name", "city", "profession", "context", "goals", "transport"):
        v = profile.get(k)
        if v:
            parts.append(str(v))
    return " ".join(parts).lower()


def _facts_text(facts: list[dict[str, Any]]) -> str:
    return " ".join(
        f"{f.get('key') or ''} {f.get('value') or ''}".lower() for f in facts
    )


def _topic_covered(topic_terms: tuple[str, ...], haystack: str) -> bool:
    return any(term in haystack for term in topic_terms)


def _pick_gap(profile: dict[str, Any] | None, facts: list[dict[str, Any]]) -> str | None:
    haystack = " ".join((_profile_text(profile), _facts_text(facts)))
    for topic, terms in TOPICS:
        if not _topic_covered(terms, haystack):
            return topic
    return None


def _on_cooldown(db: Any) -> bool:
    row = fetch_one(
        db,
        """
        SELECT MAX(datetime(created_at)) AS last_at
        FROM interview_answers
        """,
    )
    if not row or not row.get("last_at"):
        return False
    cutoff = fetch_one(
        db,
        "SELECT datetime('now', ?) AS cutoff",
        (f"-{COOLDOWN_DAYS} days",),
    )
    if not cutoff or not cutoff.get("cutoff"):
        return False
    return str(row["last_at"]) >= str(cutoff["cutoff"])


def _build_prompt(
    topic: str,
    profile: dict[str, Any] | None,
    facts: list[dict[str, Any]],
) -> str:
    profile_snippet = {
        k: profile.get(k) if profile else None
        for k in ("name", "city", "profession", "context", "goals")
    }
    facts_snippet = [
        {"key": f.get("key"), "value": f.get("value")} for f in facts[:25]
    ]
    return (
        "Ты — AIR4, личный советник. Тебе нужно задать ОДИН вопрос пользователю, "
        "чтобы лучше узнать его в области «" + topic + "».\n\n"
        "Контекст о пользователе:\n"
        f"Профиль: {json.dumps(profile_snippet, ensure_ascii=False)}\n"
        f"Известные факты: {json.dumps(facts_snippet, ensure_ascii=False)}\n\n"
        "Требования к вопросу:\n"
        "— Один короткий вопрос на русском, на «ты».\n"
        "— Точечный, не общий. Плохо: «Расскажи о себе». Хорошо: «Ты упоминал мотоцикл — "
        "ездишь каждый день или только в сезон?».\n"
        "— Если в контексте есть что-то, к чему можно зацепиться — оттолкнись от этого.\n"
        "— Без приветствий, без объяснений, без «можешь рассказать».\n"
        "— Максимум 1–2 предложения.\n\n"
        "Верни ТОЛЬКО текст вопроса. Без JSON, без кавычек, без префиксов."
    )


def _clean_question(raw: str) -> str:
    text = (raw or "").strip()
    if not text:
        return ""
    # Стрипаем кавычки если модель их добавила
    if len(text) >= 2 and text[0] in {'"', "'", "«"} and text[-1] in {'"', "'", "»"}:
        text = text[1:-1].strip()
    # Берём только первый параграф
    text = text.split("\n\n")[0].strip()
    return text


def get_pending_question(db: Any) -> dict[str, Any] | None:
    """Most recent interview_answers row with empty answer, if any."""
    row = fetch_one(
        db,
        """
        SELECT question, domain
        FROM interview_answers
        WHERE TRIM(COALESCE(answer, '')) = ''
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT 1
        """,
    )
    if not row:
        return None
    question = str(row.get("question") or "").strip()
    if not question:
        return None
    return {
        "question": question,
        "domain": str(row["domain"]) if row.get("domain") else None,
    }


async def get_interview_question(db: Any, api_key: str) -> str | None:
    """Generate and save one targeted interview question, or None if not needed."""
    if _on_cooldown(db):
        logger.debug("Interview on cooldown (%dd)", COOLDOWN_DAYS)
        return None

    if not (api_key or "").strip():
        return None

    profile = fetch_one(db, "SELECT * FROM user_profile WHERE id = ?", (_PROFILE_ID,))
    facts = fetch_all(
        db,
        """
        SELECT key, value, confidence
        FROM user_facts
        ORDER BY confidence DESC, datetime(updated_at) DESC, id DESC
        LIMIT 80
        """,
    )

    topic = _pick_gap(profile, facts)
    if topic is None:
        logger.debug("No interview gaps found")
        return None

    try:
        raw = await call_claude(
            _build_prompt(topic, profile, facts),
            api_key=api_key,
            model=DEFAULT_MODEL,
            max_tokens=300,
            temperature=0.5,
        )
    except Exception:
        logger.exception("Claude interview question generation failed")
        return None

    question = _clean_question(raw)
    if not question:
        return None

    try:
        execute(
            db,
            """
            INSERT INTO interview_answers (question, answer, domain, created_at)
            VALUES (?, '', ?, datetime('now'))
            """,
            (question, topic),
        )
    except Exception:
        logger.exception("Failed to save interview question: %s", question)
        return None

    return question


def save_interview_answer(db: Any, question: str, answer: str) -> bool:
    """Find the latest empty-answer row matching the question, update the answer."""
    q = (question or "").strip()
    a = (answer or "").strip()
    if not q or not a:
        return False

    row = fetch_one(
        db,
        """
        SELECT id FROM interview_answers
        WHERE question = ?
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT 1
        """,
        (q,),
    )
    if not row:
        return False

    execute(
        db,
        "UPDATE interview_answers SET answer = ? WHERE id = ?",
        (a, int(row["id"])),
    )
    return True
