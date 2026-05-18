from __future__ import annotations

import re
from typing import Any

CHARACTER_SYSTEM = """Ты — AIR4. Персональный советник пользователя.

Ты давно знаешь этого человека. Видел его траты, проекты, решения — хорошие и плохие.
Ты не начинаешь с нуля каждый раз.

КТО ТЫ
Не чат-бот. Не коуч. Не психолог.
Умный прямой человек который говорит как есть. Без воды, без попыток понравиться.
Твоя задача — помочь разобраться в ситуации и принять решение.

КАК ТЫ ГОВОРИШЬ
— На "ты". Всегда.
— Коротко. Без воды. Без вступлений.
— Без шаблонной мотивации. Никогда: "ты справишься", "главное не сдаваться".
— Без извинений за прямоту.
— Имя — редко. Только для акцента.
— Жёсткость только когда есть данные. Не ради образа.

ЧТО ТЫ ДЕЛАЕШЬ
Помогаешь принять следующий шаг. Не анализируешь ради анализа.
— Факты и цифры, не общие слова
— Замечаешь косвенные сигналы — паттерны в тратах, проектах, активности
— Называешь самообман прямо когда есть данные
— Каждый вывод заканчивается вопросом или конкретным действием

КОГДА МОЛЧАТЬ
Нет сильного наблюдения — не придумывай активность.
Говоришь только когда есть что сказать.
Если нечего: "Пока всё ровно."

ПАМЯТЬ
Используй всё что знаешь. Тон становится плотнее по мере накопления контекста.
Не прогибаешься под давлением. Пересматриваешь позицию только если есть аргумент.

ФОРМАТИРОВАНИЕ
— Никакого markdown: нет **, *, #
— Только plain text
— Язык ответа: русский

ВНУТРЕННИЕ ТЕГИ (КРИТИЧНО)
Никогда не включай в ответ пользователю XML-теги и блоки: <user_profile_update>, <facts>, <fact>, <events> и любые подобные.
Это внутренние служебные форматы — пользователь их не видит и не должен видеть.
Отвечай только обычным текстом на русском."""

# Paired blocks: <tag>...</tag>
_INTERNAL_XML_BLOCKS = re.compile(
    r"<(user_profile_update|facts|fact|events|event|profile_update|metadata)\b[^>]*>"
    r".*?"
    r"</\1\s*>",
    re.IGNORECASE | re.DOTALL,
)

# Lone opening/closing/self-closing internal tags
_INTERNAL_XML_TAGS = re.compile(
    r"</?(?:user_profile_update|facts|fact|events|event|profile_update|metadata)\b[^>]*/?>",
    re.IGNORECASE,
)

# Any other simple XML-like wrapper the model might emit
_GENERIC_XML_BLOCKS = re.compile(
    r"<([a-zA-Z_][\w-]*)[^>]*>.*?</\1\s*>",
    re.DOTALL,
)


def strip_internal_xml_tags(text: str) -> str:
    """Remove internal XML instruction blocks from assistant text shown to the user."""
    if not text:
        return text
    cleaned = text
    cleaned = _INTERNAL_XML_BLOCKS.sub("", cleaned)
    cleaned = _GENERIC_XML_BLOCKS.sub("", cleaned)
    cleaned = _INTERNAL_XML_TAGS.sub("", cleaned)
    cleaned = re.sub(r"[ \t]+\n", "\n", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def _format_profile(profile: dict[str, Any] | None) -> str:
    if not profile:
        return "Профиль: пока пусто."
    lines: list[str] = []
    for label, key in (
        ("Имя", "name"),
        ("Город", "city"),
        ("Профессия", "profession"),
        ("Доход/мес", "monthly_income"),
        ("Цели", "goals"),
        ("Транспорт", "transport"),
        ("Контекст", "context"),
    ):
        val = profile.get(key)
        if val is not None and str(val).strip():
            lines.append(f"- {label}: {val}")
    return "Профиль:\n" + ("\n".join(lines) if lines else "— пусто")


def _format_facts(facts: list[dict[str, Any]]) -> str:
    if not facts:
        return "Факты: пока нет."
    lines = [
        f"- {f.get('key', '')}: {f.get('value', '')}"
        for f in facts
        if str(f.get("key", "")).strip()
    ]
    return "Факты о пользователе:\n" + "\n".join(lines)


def _format_events(events: list[dict[str, Any]]) -> str:
    if not events:
        return "Недавние события: нет."
    lines: list[str] = []
    for e in events:
        date_s = e.get("date") or ""
        title = e.get("title") or ""
        desc = e.get("description") or ""
        domain = e.get("domain") or ""
        tail = f" — {desc}" if desc else ""
        lines.append(f"- {date_s} [{domain}] {title}{tail}")
    return "Недавние события:\n" + "\n".join(lines)


def _format_by_category(by_category: dict[str, Any]) -> str:
    if not by_category:
        return "нет данных"
    lines: list[str] = []
    sorted_items = sorted(
        by_category.items(),
        key=lambda item: float(item[1].get("amount", 0) if isinstance(item[1], dict) else 0),
        reverse=True,
    )
    for category, data in sorted_items:
        if isinstance(data, dict):
            amount = float(data.get("amount", 0) or 0)
            count = int(data.get("count", 0) or 0)
        else:
            amount = float(getattr(data, "amount", 0) or 0)
            count = int(getattr(data, "count", 0) or 0)
        lines.append(f"- {category}: €{amount:.2f} ({count} транз.)")
    return "\n".join(lines)


def _format_finance_block(summary: Any) -> str:
    period_start = getattr(summary, "period_start", None) or summary.get("period_start")
    period_end = getattr(summary, "period_end", None) or summary.get("period_end")
    total_spent = float(
        getattr(summary, "total_spent", None) or summary.get("total_spent") or 0
    )
    total_income = float(
        getattr(summary, "total_income", None) or summary.get("total_income") or 0
    )
    by_category = getattr(summary, "by_category", None) or summary.get("by_category") or {}

    if not period_start and not period_end and not by_category:
        return "ФИНАНСОВЫЕ ДАННЫЕ: нет загруженных выписок."

    period = f"{period_start or '?'} — {period_end or '?'}"
    return (
        f"ФИНАНСОВЫЕ ДАННЫЕ (последний период {period}):\n"
        f"Потрачено: €{total_spent:.2f}\n"
        f"Получено: €{total_income:.2f}\n"
        f"По категориям:\n{_format_by_category(by_category)}"
    )


def build_system_context(
    *,
    summary: Any,
    profile: dict[str, Any] | None,
    facts: list[dict[str, Any]],
    events: list[dict[str, Any]],
    current_page: str | None = None,
) -> str:
    parts = [
        CHARACTER_SYSTEM,
        "",
        _format_finance_block(summary),
        "",
        _format_profile(profile).replace("Профиль:", "ПРОФИЛЬ:", 1),
        "",
        _format_facts(facts).replace("Факты о пользователе:", "ФАКТЫ:", 1),
        "",
        _format_events(events).replace("Недавние события:", "СОБЫТИЯ:", 1),
    ]
    page = (current_page or "").strip()
    if page:
        parts.extend(["", f"Текущая страница UI: {page}"])
    return "\n".join(parts)


def build_chat_system(
    *,
    profile: dict[str, Any] | None,
    facts: list[dict[str, Any]],
    events: list[dict[str, Any]],
    current_page: str | None = None,
) -> str:
    """Legacy helper without finance block."""
    return build_system_context(
        summary={
            "period_start": None,
            "period_end": None,
            "total_spent": 0,
            "total_income": 0,
            "by_category": {},
        },
        profile=profile,
        facts=facts,
        events=events,
        current_page=current_page,
    )


def history_to_messages(history: list[dict[str, Any]]) -> list[dict[str, str]]:
    messages: list[dict[str, str]] = []
    for item in history[-20:]:
        role = str(item.get("role") or "user").lower()
        content = str(item.get("content") or "").strip()
        if not content:
            continue
        if role not in ("user", "assistant"):
            role = "user"
        messages.append({"role": role, "content": content})
    return messages
