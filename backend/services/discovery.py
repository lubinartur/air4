"""Discovery gaps — systematic learning about the user through conversation."""

from __future__ import annotations

import logging
import re
from typing import Any

from database import fetch_all, get_meta, set_meta

logger = logging.getLogger("discovery")

DEFAULT_GAPS: tuple[tuple[str, str, int], ...] = (
    ("daily_rhythm", "Как выглядит типичный день пользователя — утро, работа, вечер", 3),
    ("work_hours", "В какое время пользователь работает лучше всего", 3),
    ("energy_pattern", "Когда энергия высокая, когда падает", 2),
    ("work_style", "Как пользователь предпочитает работать — один или в команде, офис или дом", 2),
    ("focus_blockers", "Что мешает сосредоточиться и работать", 3),
    ("project_motivation", "Почему строит то что строит — что движет", 3),
    ("living_situation", "С кем живёт, семья, отношения", 2),
    ("city_life", "Как использует Таллин — где проводит время", 1),
    ("social_battery", "Интроверт или экстраверт, как восстанавливается", 2),
    ("sleep_pattern", "Сколько спит, во сколько ложится и встаёт", 3),
    ("stress_signals", "Как проявляется стресс у пользователя", 2),
    ("recovery_style", "Как восстанавливается после тяжёлых периодов", 2),
    ("core_fear", "Чего боится больше всего в жизни и работе", 2),
    ("definition_of_success", "Что для него значит успех через 5 лет", 3),
    ("non_negotiables", "Что никогда не готов жертвовать", 3),
    ("money_relationship", "Как относится к деньгам — инструмент, безопасность, свобода", 2),
    ("spending_guilt", "Есть ли чувство вины от трат, на что", 1),
    ("decision_style", "Как принимает важные решения — быстро или долго", 2),
    ("advice_seeking", "К кому обращается за советом", 1),
)

_GAP_ANSWER_KEYWORDS: dict[str, tuple[str, ...]] = {
    "daily_rhythm": ("утр", "вечер", "распоряд", "будиль", "просып", "типичн день"),
    "work_hours": ("ноч", "утр", "вечер", "работаю лучше", "продуктив", "пик работ"),
    "energy_pattern": ("энерг", "уста", "падает", "бодр", "выгор"),
    "work_style": ("команд", "один", "офис", "дом", "удалён", "remote"),
    "focus_blockers": ("отвлек", "мешает", "сосредот", "фокус", "прокраст"),
    "project_motivation": ("движет", "строю потому", "мотив", "зачем стро"),
    "living_situation": ("живу", "семь", "жена", "жён", "парн", "дет", "один жив"),
    "city_life": ("таллин", "tallinn", "город", "кафе", "провожу время"),
    "social_battery": ("интров", "экстрав", "восстанав", "одиноч", "люди"),
    "sleep_pattern": ("сплю", "ложусь", "встаю", "сон", "часов сна", "бессон"),
    "stress_signals": ("стресс", "тревож", "нерв", "раздраж", "паник"),
    "recovery_style": ("восстанав", "отдых", "перезагруз", "отпуск"),
    "core_fear": ("боюсь", "страш", "страх", "опас"),
    "definition_of_success": ("успех", "5 лет", "через три года", "цель жизни"),
    "non_negotiables": ("не готов жертв", "принцип", "никогда не", "не отдам"),
    "money_relationship": ("деньг", "финанс", "безопасност", "свобод", "инструмент"),
    "spending_guilt": ("вина", "трат", "покуп", "жалко"),
    "decision_style": ("решени", "быстро реша", "долго дума", "колебл"),
    "advice_seeking": ("совет", "обраща", "ментор", "друг", "спрашива"),
}

_PRIORITY_LABELS = {1: "низкий", 2: "средний", 3: "высокий"}


def seed_discovery_gaps(conn: Any) -> None:
    """Insert default gaps once; idempotent via _app_meta."""
    if get_meta(conn, "discovery_gaps_seeded") == "1":
        return
    for category, question_hint, priority in DEFAULT_GAPS:
        conn.execute(
            """
            INSERT OR IGNORE INTO discovery_gaps (
                category, question_hint, priority, status, created_at, updated_at
            )
            VALUES (?, ?, ?, 'open', datetime('now'), datetime('now'))
            """,
            (category, question_hint, priority),
        )
    set_meta(conn, "discovery_gaps_seeded", "1")


def get_open_gaps(conn: Any, limit: int = 3) -> list[dict[str, Any]]:
    rows = fetch_all(
        conn,
        """
        SELECT id, category, question_hint, priority, status,
               learned_value, last_asked, created_at, updated_at
        FROM discovery_gaps
        WHERE status = 'open'
          AND (
            last_asked IS NULL
            OR last_asked < datetime('now', '-3 days')
          )
        ORDER BY priority DESC, last_asked ASC, id ASC
        LIMIT ?
        """,
        (int(limit),),
    )
    return rows


def get_all_gaps(conn: Any) -> list[dict[str, Any]]:
    return fetch_all(
        conn,
        """
        SELECT id, category, question_hint, priority, status,
               learned_value, last_asked, created_at, updated_at
        FROM discovery_gaps
        ORDER BY priority DESC, category ASC
        """,
    )


def _gap_short_label(question_hint: str) -> str:
    text = question_hint.split("—")[0].strip()
    text = text.replace(" пользователя", "").replace(" пользователь", "")
    return text


def format_discovery_gaps_context(gaps: list[dict[str, Any]]) -> str:
    if not gaps:
        return ""
    lines = ["[ПРОБЕЛЫ В ПОНИМАНИИ]", "Пока не знаю:"]
    for gap in gaps:
        priority = int(gap.get("priority") or 2)
        pri_label = _PRIORITY_LABELS.get(priority, "средний")
        hint = str(gap.get("question_hint") or gap.get("category") or "")
        lines.append(f"- {_gap_short_label(hint)} (приоритет: {pri_label})")
    return "\n".join(lines)


def _text_matches_gap(text: str, category: str) -> bool:
    lowered = (text or "").lower()
    if not lowered:
        return False
    keywords = _GAP_ANSWER_KEYWORDS.get(category, ())
    return any(kw in lowered for kw in keywords)


def mark_gap_learned(conn: Any, category: str, learned_value: str) -> None:
    value = (learned_value or "").strip()
    if not value:
        return
    conn.execute(
        """
        UPDATE discovery_gaps
        SET status = 'learned',
            learned_value = ?,
            updated_at = datetime('now')
        WHERE category = ? AND status = 'open'
        """,
        (value[:1000], category),
    )


def apply_facts_to_discovery_gaps(
    conn: Any, facts: list[dict[str, Any]]
) -> None:
    for fact in facts:
        key = str(fact.get("key") or "").strip()
        value = str(fact.get("value") or "").strip()
        combined = f"{key} {value}".strip()
        if not combined:
            continue
        for category in _GAP_ANSWER_KEYWORDS:
            if _text_matches_gap(combined, category):
                mark_gap_learned(conn, category, value or combined)


def apply_user_text_to_discovery_gaps(
    conn: Any, user_messages: list[str]
) -> None:
    combined = " ".join(m.strip() for m in user_messages if (m or "").strip())
    if not combined:
        return
    for category in _GAP_ANSWER_KEYWORDS:
        if _text_matches_gap(combined, category):
            mark_gap_learned(conn, category, combined[:500])


def _response_asks_about_gap(response_text: str, gap: dict[str, Any]) -> bool:
    text = response_text.lower()
    category = str(gap.get("category") or "")
    if _text_matches_gap(text, category):
        return True
    hint = str(gap.get("question_hint") or "").lower()
    tokens = [t for t in re.findall(r"[\wа-яё]+", hint) if len(t) >= 5]
    matches = sum(1 for token in tokens[:6] if token in text)
    return matches >= 2


def mark_gaps_asked_in_response(conn: Any, response_text: str) -> None:
    """If the assistant asked about an open gap, bump last_asked."""
    text = (response_text or "").strip()
    if not text or "?" not in text:
        return
    gaps = fetch_all(
        conn,
        """
        SELECT id, category, question_hint
        FROM discovery_gaps
        WHERE status = 'open'
        """,
    )
    for gap in gaps:
        if not _response_asks_about_gap(text, gap):
            continue
        conn.execute(
            """
            UPDATE discovery_gaps
            SET last_asked = datetime('now'),
                updated_at = datetime('now')
            WHERE id = ?
            """,
            (int(gap["id"]),),
        )
