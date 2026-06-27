from __future__ import annotations

import json
import re
from typing import Any

CHAT_RESPONSE_FORMAT = """\
FORMATTING RULES:
- Do NOT use markdown bold (**text**) in regular responses
- Do NOT use bullet points (•) unless listing 4+ items
- Do NOT use numbered lists unless steps must be sequential
- Do NOT use headers (##) in chat responses
- Write in plain flowing prose
- One idea per paragraph, short paragraphs
- Only use code blocks for actual code or SQL

The response should read like a smart person texting — not like a formatted document.

Bad: "**Возможные причины:**
• Пункт 1
• Пункт 2"
Good: "Скорее всего проблема в кэше на фронте — UI не перечитывает данные после изменений."
"""

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
Тон становится плотнее по мере накопления контекста.

ПЕРЕД ТЕМ КАК СКАЗАТЬ "Я НЕ ПОМНЮ":
Внимательно перечитай блоки СОБЫТИЯ и НАЙДЕНО В ПАМЯТИ ниже.
Если ничего точного не находишь, скажи "не вижу этого в памяти, напомни" —
не утверждай, что ничего не происходило. Пользователь видит свои события
в разделе Память и легко тебя поймает на промахе.

""" + CHAT_RESPONSE_FORMAT

# Shared output contract for Overview-facing LLM text (recommendation hero,
# open-loop observations). Analytical/extraction prompts must NOT use this.
OVERVIEW_ADVISOR_FORMAT = """\
ОБЯЗАТЕЛЬНАЯ СТРУКТУРА (4 предложения подряд, без нумерации и заголовков):
1. Что происходит — одно предложение-факт с цифрами когда они есть
2. Почему это важно — одно предложение, контекст или риск
3. Что рекомендую — одна конкретная рекомендация (решение, не перечень проблем)
4. Одно действие сегодня — одно конкретное действие, выполнимое сегодня

Правила:
- Никогда не заканчивай только наблюдением — всегда доводи до шага
- Будь конкретен с цифрами когда они есть в данных ("отложи 1000€", "закрой один из трёх проектов")
- Не перечисляй проблемы — предлагай решения
- Тон: прямой, как умный советник который видит полную картину
- Язык: русский, обращение на "ты"

Пример:
"Резервный фонд — 500€, это меньше одного месяца обязательств. При ипотеке и двух кредитах это реальный риск если что-то пойдёт не так. Я бы в следующие 30 дней отложил ещё 1000€ — для этого достаточно сократить рестораны вдвое. Сегодня: реши конкретную сумму которую откладываешь каждый 10-го числа автоматически."

Ещё пример:
"Air4, Тартупак и SkipMar не двигались 27–52 дня одновременно — это не случайность, это распыление. Держать три незавершённых проекта дороже чем кажется: ни один не движется. Я бы сегодня выбрал один — закрыл или дал конкретный следующий шаг. Сегодня: открой каждый и за 5 минут реши — active или archive."
"""

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
    # Subscriptions live in the dedicated `subscriptions` table now; filter
    # any fact whose subject overlaps with subscriptions so AIR4 never quotes
    # stale or duplicated pricing alongside the authoritative table data.
    from services.fact_extractor import is_subscription_related_key

    visible = [
        f for f in facts
        if str(f.get("key", "")).strip()
        and not is_subscription_related_key(str(f.get("key", "")))
    ]
    if not visible:
        return "Факты: пока нет."
    lines = [f"- {f.get('key', '')}: {f.get('value', '')}" for f in visible]
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


def get_subscriptions_context(db: Any) -> str:
    """Active subscriptions and their monthly amounts.

    Authoritative — read from the `subscriptions` table, never from
    `user_facts`. Returns an empty string when there are no active rows
    so the caller can skip the section entirely.
    """
    from database import fetch_all  # local import to avoid circular at module load

    try:
        rows = fetch_all(
            db,
            """
            SELECT name, amount, currency, billing_day, category
            FROM subscriptions
            WHERE COALESCE(is_active, 1) = 1
            ORDER BY
                CASE WHEN amount IS NULL THEN 1 ELSE 0 END,
                amount DESC,
                name ASC
            """,
        )
    except Exception:
        return ""
    if not rows:
        return ""

    lines: list[str] = []
    total = 0.0
    for row in rows:
        name = str(row.get("name") or "?").strip() or "?"
        amount = row.get("amount")
        currency = str(row.get("currency") or "EUR").upper()
        symbol = "€" if currency == "EUR" else f"{currency} "
        if isinstance(amount, (int, float)) and amount > 0:
            try:
                total += float(amount)
                amount_str = f"{symbol}{float(amount):.2f}/мес"
            except (TypeError, ValueError):
                amount_str = "цена неизвестна"
        else:
            amount_str = "цена неизвестна"
        billing_day = row.get("billing_day")
        suffix = f" (день {int(billing_day)})" if isinstance(billing_day, (int, float)) and billing_day else ""
        lines.append(f"- {name}: {amount_str}{suffix}")

    header = "ПОДПИСКИ (источник истины — таблица subscriptions):"
    body = "\n".join(lines)
    if total > 0:
        body += f"\nИтого: €{total:.2f}/мес"
    return f"{header}\n{body}"


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


def _format_relevant_events(events: list[dict[str, Any]]) -> str:
    """Format semantic-search matches as a distinct memory block.

    Kept separate from the recency block so the LLM knows these rows
    came from a keyword lookup against the WHOLE archive — they may be
    older than the 30-day recent window and shouldn't be dropped just
    because the date is stale.
    """
    if not events:
        return ""
    lines: list[str] = []
    for e in events:
        date_s = e.get("date") or ""
        title = e.get("title") or ""
        desc = e.get("description") or ""
        domain = e.get("domain") or ""
        tail = f" — {desc}" if desc else ""
        lines.append(f"- {date_s} [{domain}] {title}{tail}")
    return "НАЙДЕНО В ПАМЯТИ (релевантно теме разговора):\n" + "\n".join(lines)


# Words that contribute zero signal for keyword matching. Includes
# common Russian conversational fillers ("помнишь", "что", "как"),
# function words, and English stop words. Cheap and good enough for
# the LIKE-based recall — we can swap in proper embeddings later.
_KEYWORD_STOPWORDS: set[str] = {
    # russian connectives / fillers
    "что", "как", "это", "был", "была", "было", "были", "есть", "тут", "там",
    "ещё", "еще", "уже", "очень", "просто", "тоже", "если", "когда", "пока",
    "сейчас", "сегодня", "вчера", "завтра", "потом", "после", "раньше",
    "так", "вот", "ну", "да", "нет", "или", "ли", "же", "бы", "чтобы",
    "чтоб", "тебя", "тебе", "меня", "мне", "мной", "тобой", "себя",
    "помнишь", "помню", "помнить", "напомни", "знаешь", "знаю", "знать",
    "скажи", "скажу", "говорил", "говорила", "сказал", "сказала", "думаю",
    "вижу", "видел", "видела", "слышал", "слышала", "почему", "зачем",
    "когда", "где", "куда", "откуда", "сколько", "какой", "какая", "какие",
    "наш", "наша", "наше", "наши", "мой", "моя", "моё", "мои", "твой",
    "твоя", "твоё", "твои", "свой", "своя", "своё", "свои",
    "про", "для", "над", "под", "при", "без", "через",
    # english stop words
    "the", "and", "for", "with", "from", "this", "that", "have", "has", "had",
    "you", "your", "yours", "are", "was", "were", "been", "being", "what",
    "when", "where", "why", "how", "did", "does", "doing", "remember",
    "tell", "know", "think", "show", "find", "still", "yet", "also",
}


def _extract_keywords(text: str) -> list[str]:
    """Pluck meaningful tokens for a LIKE-based events lookup.

    Heuristics: lowercase, alphanum + Cyrillic + dashes, drop tokens
    shorter than 4 chars, drop stop words, dedupe in document order,
    cap at 6 tokens. The cap keeps the resulting SQL OR chain short
    enough that the query plan stays a single full scan of `events`
    (table is tiny so this is fine).
    """
    if not text or not text.strip():
        return []
    tokens = re.findall(r"[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё0-9\-]{2,}", text.lower())
    seen: set[str] = set()
    out: list[str] = []
    for tok in tokens:
        if len(tok) < 4:
            continue
        if tok in _KEYWORD_STOPWORDS:
            continue
        if tok in seen:
            continue
        seen.add(tok)
        out.append(tok)
        if len(out) >= 6:
            break
    return out


def search_relevant_events(
    db: Any, query: str, *, limit: int = 5
) -> list[dict[str, Any]]:
    """Find events whose title or description matches the user's message.

    Returns ``[]`` when no usable keywords can be extracted. Matches
    are scored by hit count (more keywords matched → ranks higher),
    ties broken by recency. Searches the WHOLE non-archived archive
    so older events the recency block missed can still surface when
    the conversation calls them up by name.
    """
    from database import fetch_all  # local import to avoid circular

    keywords = _extract_keywords(query)
    if not keywords:
        return []

    like_clauses: list[str] = []
    params: list[Any] = []
    for kw in keywords:
        like = f"%{kw}%"
        like_clauses.append("(LOWER(title) LIKE ? OR LOWER(description) LIKE ?)")
        params.extend([like, like])

    where = " OR ".join(like_clauses)

    score_parts: list[str] = []
    for _ in keywords:
        score_parts.append(
            "(CASE WHEN LOWER(title) LIKE ? OR LOWER(description) LIKE ? THEN 1 ELSE 0 END)"
        )
    score_params: list[Any] = []
    for kw in keywords:
        like = f"%{kw}%"
        score_params.extend([like, like])

    sql = f"""
        SELECT id, date, title, description, domain, category,
               ({' + '.join(score_parts)}) AS score
        FROM events
        WHERE COALESCE(archived, 0) = 0
          AND ({where})
        ORDER BY score DESC, datetime(created_at) DESC, id DESC
        LIMIT ?
    """
    try:
        rows = fetch_all(db, sql, tuple(score_params + params + [int(limit)]))
    except Exception:
        return []
    return rows


def _format_by_category(by_category: dict[str, Any]) -> str:
    if not by_category:
        return "нет данных"
    lines: list[str] = []
    sorted_items = sorted(
        by_category.items(),
        key=lambda item: float(
            item[1].get("amount", 0)
            if isinstance(item[1], dict)
            else getattr(item[1], "amount", 0) or 0
        ),
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
    period_start = getattr(summary, "period_start", None)
    period_end = getattr(summary, "period_end", None)
    total_spent = float(getattr(summary, "total_spent", 0) or 0)
    total_income = float(getattr(summary, "total_income", 0) or 0)
    by_category = getattr(summary, "by_category", None) or {}

    if not period_start and not period_end and not by_category:
        return "ФИНАНСОВЫЕ ДАННЫЕ: нет загруженных выписок."

    period = f"{period_start or '?'} — {period_end or '?'}"
    return (
        f"ФИНАНСОВЫЕ ДАННЫЕ (последний период {period}):\n"
        f"Потрачено: €{total_spent:.2f}\n"
        f"Получено: €{total_income:.2f}\n"
        f"По категориям:\n{_format_by_category(by_category)}"
    )


def get_observer_context(db: Any) -> str:
    """Today's macOS activity observer summary for the chat system prompt."""
    from database import fetch_all  # local import to avoid circular at module load

    rows = fetch_all(
        db,
        """
        SELECT app_name, project_hint, duration_seconds
        FROM observer_events
        WHERE date(observed_at) = date('now', 'localtime')
        ORDER BY duration_seconds DESC
        """,
    )
    if not rows:
        return ""

    by_key: dict[str, dict[str, Any]] = {}
    for row in rows:
        app = str(row.get("app_name") or "").strip()
        if not app:
            continue
        hint = str(row.get("project_hint") or "").strip()
        key = f"{app}:{hint}"
        if key not in by_key:
            by_key[key] = {"app": app, "hint": hint, "seconds": 0}
        by_key[key]["seconds"] += int(row.get("duration_seconds") or 0)

    lines = ["[НАБЛЮДЕНО СЕГОДНЯ]"]
    for item in sorted(by_key.values(), key=lambda x: -x["seconds"]):
        mins = item["seconds"] // 60
        if item["hint"]:
            lines.append(f"- {item['app']}: {item['hint']} — {mins} мин")
        else:
            lines.append(f"- {item['app']} — {mins} мин")
    return "\n".join(lines)


def build_system_context(
    *,
    summary: Any,
    profile: dict[str, Any] | None,
    facts: list[dict[str, Any]],
    events: list[dict[str, Any]],
    workouts_context: str = "",
    health_checkups_context: str = "",
    subscriptions_context: str = "",
    observer_context: str = "",
    current_page: str | None = None,
    relevant_events: list[dict[str, Any]] | None = None,
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
        _format_events(events).replace("Недавние события:", "СОБЫТИЯ (последние 30 дней):", 1),
    ]
    relevant_block = _format_relevant_events(relevant_events or [])
    if relevant_block:
        parts.extend(["", relevant_block])
    subs_text = (subscriptions_context or "").strip()
    if subs_text:
        parts.extend(["", subs_text])
    workouts_text = (workouts_context or "").strip()
    if workouts_text:
        parts.extend(["", workouts_text])
    health_text = (health_checkups_context or "").strip()
    if health_text:
        parts.extend(["", health_text])
    observer_text = (observer_context or "").strip()
    if observer_text:
        parts.extend(["", observer_text])
    page = (current_page or "").strip()
    if page:
        parts.extend(["", f"Текущая страница UI: {page}"])
    return "\n".join(parts)


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


def get_recent_chat_history(db: Any, limit: int = 10) -> list[dict[str, str]]:
    """Load the most recent chat messages from the DB as LLM-ready dicts.

    Returned in chronological order (oldest first) so the resulting list can
    be appended directly to the LLM `messages` payload.
    """
    from services.chat_history import fetch_recent_chat_messages

    out: list[dict[str, str]] = []
    try:
        rows = fetch_recent_chat_messages(db, limit=limit)
    except Exception:
        return out
    for row in rows:
        role = str(row.get("role") or "user").lower()
        if role not in ("user", "assistant"):
            role = "user"
        content = str(row.get("content") or "").strip()
        if not content:
            continue
        out.append({"role": role, "content": content})
    return out
