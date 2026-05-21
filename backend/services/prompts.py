from __future__ import annotations

import json
import re
from typing import Any

CHARACTER_SYSTEM = """Ты — AIR4. Не ассистент. Не dashboard. Не productivity tool.

Ты — умный, спокойный, честный компаньон который давно знает этого человека.
Ты помнишь прошлые разговоры. Ты видишь паттерны. Ты говоришь как есть.

КАК ТЫ ГОВОРИШЬ:
— Разговорно. Не bullet points. Живой текст.
— Коротко когда можно. Развёрнуто когда нужно.
— Иногда с лёгкой иронией. Никогда не саркастично.
— На "ты". Всегда.
— Без корпоративного языка. Без "конечно!", "отличный вопрос!", "я понимаю".
— Иногда сам начинаешь тему если есть что сказать.
— Продолжаешь прошлые разговоры естественно.

ЧТО ТЫ ДЕЛАЕШЬ:
— Связываешь сферы между собой. Финансы ↔ проекты ↔ здоровье.
— Ведёшь thinking process, не просто отвечаешь на вопросы.
— Иногда просто разговариваешь — без анализа, без советов.
— Замечаешь паттерны которые человек сам не видит.
— Возвращаешься к тому о чём говорили раньше.

ПРИМЕРЫ ПРАВИЛЬНОГО ТОНА:
Вместо: "Вы потратили €340 на рестораны в этом месяце."
Пиши: "Рестораны снова растут. Уже третий раз когда AIR4 буксует."

Вместо: "У вас 3 активных проекта."
Пиши: "Ты снова пытаешься двигать слишком много одновременно."

Вместо: "Как я могу помочь?"
Пиши: "Что происходит?" или просто молчи и жди.

НА ПРОСТЫЕ ВОПРОСЫ ("как день?", "что думаешь?"):
Отвечай коротко и живо. Не превращай в анализ.
Можешь сам спросить что-то в ответ.

ГРАНИЦЫ:
— Не therapist. Не мотивационный коуч.
— Не говоришь "ты справишься" и "главное не сдаваться".
— Не overly emotional. Не "AI best friend".
— Grounded. Честный. Иногда неудобный.
— Жёсткость только когда есть данные. Не ради образа.

ПАМЯТЬ:
Используй всё что знаешь о человеке.
Ссылайся на прошлые разговоры естественно — как человек который помнит.
Тон становится плотнее по мере накопления контекста."""

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


def _parse_exercises_json(raw: Any) -> list[dict[str, Any]]:
    if not raw:
        return []
    if isinstance(raw, list):
        items = raw
    else:
        try:
            items = json.loads(str(raw))
        except (json.JSONDecodeError, TypeError):
            return []
        if not isinstance(items, list):
            return []
    out: list[dict[str, Any]] = []
    for item in items:
        if isinstance(item, dict):
            out.append(item)
    return out


def _exercise_max_weight(exercise: dict[str, Any]) -> float | None:
    sets = exercise.get("sets")
    if not isinstance(sets, list):
        return None
    best: float | None = None
    for s in sets:
        if not isinstance(s, dict):
            continue
        w = s.get("weight")
        try:
            w_val = float(w) if w is not None else None
        except (TypeError, ValueError):
            continue
        if w_val is None:
            continue
        if best is None or w_val > best:
            best = w_val
    return best


def _format_workouts(workouts: list[dict[str, Any]]) -> str:
    if not workouts:
        return "ТРЕНИРОВКИ (Coaich): нет записей."

    lines: list[str] = ["ТРЕНИРОВКИ (последние 10 из Coaich):"]
    for w in workouts:
        date_s = str(w.get("date") or "").strip() or "?"
        type_s = str(w.get("type") or "").strip() or "—"
        duration = w.get("duration")
        duration_part = f" {duration} min" if duration not in (None, "") else ""
        lines.append(f"- {date_s} [{type_s}]{duration_part}")

        exercises = _parse_exercises_json(w.get("exercises"))
        if not exercises:
            continue

        ranked: list[tuple[float, str]] = []
        for ex in exercises:
            name = str(ex.get("exerciseName") or ex.get("name") or "").strip()
            if not name:
                continue
            max_w = _exercise_max_weight(ex)
            ranked.append((max_w if max_w is not None else -1.0, name))

        ranked.sort(key=lambda pair: pair[0], reverse=True)
        for weight_val, name in ranked[:3]:
            if weight_val >= 0:
                lines.append(f"  · {name} — {weight_val:g} kg")
            else:
                lines.append(f"  · {name}")
    return "\n".join(lines)


def get_workouts_context(db: Any) -> str:
    """Last 10 Coaich workouts formatted for the chat system prompt."""
    from database import fetch_all  # local import to avoid circular at module load

    rows = fetch_all(
        db,
        """
        SELECT date, type, duration, exercises
        FROM workouts
        WHERE source = 'coaich'
        ORDER BY date DESC, id DESC
        LIMIT 10
        """,
    )
    return _format_workouts(rows)


def _format_marker_value(value: Any) -> str:
    try:
        num = float(value)
    except (TypeError, ValueError):
        return str(value) if value is not None else "?"
    if num == int(num):
        return str(int(num))
    formatted = f"{num:g}"
    return formatted


def _format_health_checkups(
    checkups: list[tuple[str, list[dict[str, Any]]]],
) -> str:
    if not checkups:
        return "АНАЛИЗЫ: нет загруженных результатов."

    lines: list[str] = ["АНАЛИЗЫ (последние выходы за норму):"]
    for date, markers in checkups:
        if not markers:
            lines.append(f"- {date}: всё в норме")
            continue
        parts: list[str] = []
        for m in markers:
            name = str(m.get("marker_name") or "").strip()
            if not name:
                continue
            value = _format_marker_value(m.get("value"))
            unit = str(m.get("unit") or "").strip()
            status = str(m.get("status") or "").strip().upper() or "?"
            unit_part = f" {unit}" if unit else ""
            parts.append(f"{name} {value}{unit_part} ({status})")
        if parts:
            lines.append(f"- {date}: " + ", ".join(parts))
        else:
            lines.append(f"- {date}: всё в норме")
    return "\n".join(lines)


def get_health_checkups_context(db: Any) -> str:
    """Out-of-range markers from the last 2 checkup dates, max 10 per date."""
    from database import fetch_all  # local import to avoid circular at module load

    date_rows = fetch_all(
        db,
        """
        SELECT DISTINCT date
        FROM health_checkups
        ORDER BY date DESC
        LIMIT 2
        """,
    )
    if not date_rows:
        return _format_health_checkups([])

    checkups: list[tuple[str, list[dict[str, Any]]]] = []
    for row in date_rows:
        date_s = str(row.get("date") or "").strip()
        if not date_s:
            continue
        markers = fetch_all(
            db,
            """
            SELECT marker_name, value, unit, status
            FROM health_checkups
            WHERE date = ?
              AND status IN ('HIGH', 'LOW')
            ORDER BY status, marker_name
            LIMIT 10
            """,
            (date_s,),
        )
        checkups.append((date_s, markers))
    return _format_health_checkups(checkups)


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
    workouts_context: str = "",
    health_checkups_context: str = "",
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
    workouts_text = (workouts_context or "").strip()
    if workouts_text:
        parts.extend(["", workouts_text])
    health_text = (health_checkups_context or "").strip()
    if health_text:
        parts.extend(["", health_text])
    page = (current_page or "").strip()
    if page:
        parts.extend(["", f"Текущая страница UI: {page}"])
    return "\n".join(parts)


def build_chat_system(
    *,
    profile: dict[str, Any] | None,
    facts: list[dict[str, Any]],
    events: list[dict[str, Any]],
    workouts_context: str = "",
    health_checkups_context: str = "",
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
        workouts_context=workouts_context,
        health_checkups_context=health_checkups_context,
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
