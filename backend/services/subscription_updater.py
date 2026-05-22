"""Detect and apply price corrections to subscriptions/obligations.

The chat pipeline calls :func:`apply_recurring_corrections` after the LLM
response is generated.  A user message such as

    "Страховка мотоцикл стоит 15.61 евро, не 43"

is parsed into

    {name: "Страховка Мотоцикл", new_amount: 15.61}

and the matching row in `subscriptions` or `obligations` is updated.

Detection is intentionally conservative: we only update when ALL non-stop
tokens of a stored item's name appear in the message, and we ignore
amounts that are explicitly tagged as wrong ("не 43", "вместо 43").
"""

from __future__ import annotations

import logging
import re
from typing import Any

from database import execute, fetch_all

logger = logging.getLogger("subscription_updater")

_MIN_TOKEN_LEN = 4
_STEM_LEN = 5

_STOPWORDS: set[str] = {
    # Russian fillers / common words
    "стоит", "стоимость", "цена", "теперь", "сейчас", "реально",
    "евро", "месяц", "ежемесячно", "каждый",
    "поменяй", "обнови", "измени", "исправь", "обновить", "поменять",
    "вместо", "также", "тоже", "уже", "ещё", "еще",
    # Deletion-intent verbs — don't let them anchor name matches.
    "удали", "удалить", "удалите", "удалил", "удаление",
    "убери", "убрать", "уберём", "уберем", "убирай",
    "снеси", "снести", "снёс", "выкинь", "выкини",
    "отмени", "отменить", "отпиши", "отпишусь", "отписался", "отписаться",
    # English
    "cost", "costs", "price", "monthly", "month", "actually",
    "instead", "update", "change", "set", "fix", "correct",
    "per", "now", "the", "and", "for", "with",
    "remove", "removed", "delete", "deleted", "cancel", "cancelled",
}

# Amount adjacent to a currency token: "€12", "12 евро", "12 EUR".
_CURRENCY_AMOUNT_RE = re.compile(
    r"(?:€\s*([\d][\d\s]*(?:[.,]\d+)?))"
    r"|(?:([\d][\d\s]*(?:[.,]\d+)?)\s*(?:€|евро|EUR|eur)\b)",
    re.IGNORECASE,
)

# Bare decimal number (price-shaped: 15.61, 401,72) — counted as an amount
# even without an adjacent currency token.
_DECIMAL_NUMBER_RE = re.compile(r"(?<![\w.,])(\d{1,5}[.,]\d{1,2})(?![\w.,])")

# Amounts that the user explicitly tags as wrong.  Triggered by:
#   "не 43", "не €43", "not 43", "вместо 43", "instead of 43"
_WRONG_AMOUNT_RE = re.compile(
    r"(?:\bне\b|\bnot\b|\bвместо\b|\binstead\s+of\b)\s*"
    r"(?:€\s*)?([\d][\d\s]*(?:[.,]\d+)?)\s*(?:€|евро|EUR|eur)?",
    re.IGNORECASE,
)

# Deletion intent.  Matches Russian verb stems with any ending plus the
# common English equivalents.  `\b` is Unicode-aware in Python 3.
_DELETE_INTENT_RE = re.compile(
    r"(?:^|\W)("
    r"удал[а-яё]*|убер[а-яё]*|убир[а-яё]*|сн[её]с[а-яё]*|"
    r"выкин[а-яё]*|отмен[а-яё]*|отпи[сш][а-яё]*|"
    r"remove[ds]?|delete[ds]?|cancel(?:l?ed)?"
    r")(?:$|\W)",
    re.IGNORECASE,
)


def _parse_amount(raw: str) -> float | None:
    try:
        return round(float(raw.replace(" ", "").replace(",", ".")), 2)
    except (TypeError, ValueError):
        return None


def _find_all_amounts(text: str) -> list[float]:
    """All numeric amounts in the message, in document order.

    Includes:
      • numbers adjacent to €/евро/EUR
      • bare decimal numbers (15.61, 401,72) — likely prices

    Excludes bare integers without a currency token to avoid false
    positives like "встретимся в 18".
    """
    spans: list[tuple[int, int, float]] = []
    for m in _CURRENCY_AMOUNT_RE.finditer(text):
        raw = m.group(1) or m.group(2) or ""
        val = _parse_amount(raw)
        if val is not None and val > 0:
            spans.append((m.start(), m.end(), val))
    for m in _DECIMAL_NUMBER_RE.finditer(text):
        if any(s <= m.start() < e for s, e, _ in spans):
            continue
        val = _parse_amount(m.group(1))
        if val is None or val <= 0 or val > 1_000_000:
            continue
        spans.append((m.start(), m.end(), val))
    spans.sort(key=lambda t: t[0])
    return [v for _, _, v in spans]


def _find_wrong_amounts(text: str) -> set[float]:
    out: set[float] = set()
    for m in _WRONG_AMOUNT_RE.finditer(text):
        val = _parse_amount(m.group(1) or "")
        if val is not None and val > 0:
            out.add(val)
    return out


def _pick_correction_amount(text: str) -> float | None:
    """Pick the amount the user is asserting as correct.

    Removes any explicitly-wrong amounts ("не 43", "вместо 43") from the
    candidate set.  If multiple candidates remain, the LAST one wins —
    e.g. "с 43 на 15.61" → 15.61.
    """
    all_amounts = _find_all_amounts(text)
    if not all_amounts:
        return None
    wrong = _find_wrong_amounts(text)
    candidates = [a for a in all_amounts if a not in wrong]
    if not candidates:
        return None
    return candidates[-1]


def _normalize(text: str) -> str:
    return re.sub(r"[^\w\s]+", " ", (text or "").lower())


def _tokenize(text: str) -> list[str]:
    return [
        t for t in _normalize(text).split()
        if len(t) >= _MIN_TOKEN_LEN and t not in _STOPWORDS
    ]


def _stem(token: str) -> str:
    """Crude prefix stem so Russian inflections collapse together.

    "страховка" / "страховку" → both stem to "страх".
    English words shorter than the stem length stay intact.
    """
    return token[:_STEM_LEN]


def _name_tokens(name: str) -> list[str]:
    return _tokenize(name)


def _full_name_match(name: str, message_stems: set[str]) -> bool:
    tokens = _name_tokens(name)
    if not tokens:
        return False
    return all(_stem(t) in message_stems for t in tokens)


def _pick_best(
    rows: list[dict[str, Any]], message_stems: set[str]
) -> dict[str, Any] | None:
    """Pick the most specific row whose name fully matches the message."""
    best: dict[str, Any] | None = None
    best_specificity = 0
    for row in rows:
        name = str(row.get("name") or "")
        if not _full_name_match(name, message_stems):
            continue
        specificity = len(_name_tokens(name))
        if specificity > best_specificity:
            best = row
            best_specificity = specificity
    return best


def _load_rows(db: Any) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    try:
        subs = fetch_all(
            db,
            "SELECT id, name, amount, currency FROM subscriptions "
            "WHERE COALESCE(is_active, 1) = 1",
        )
        obls = fetch_all(
            db,
            "SELECT id, name, monthly_payment FROM obligations "
            "WHERE COALESCE(is_active, 1) = 1",
        )
    except Exception:
        logger.exception("Failed to load recurring rows for match")
        return [], []
    return [dict(r) for r in subs], [dict(r) for r in obls]


def _choose(
    subs: list[dict[str, Any]],
    obls: list[dict[str, Any]],
    message_stems: set[str],
) -> tuple[str | None, dict[str, Any] | None]:
    sub_match = _pick_best(subs, message_stems)
    obl_match = _pick_best(obls, message_stems)
    sub_spec = len(_name_tokens(str(sub_match["name"]))) if sub_match else 0
    obl_spec = len(_name_tokens(str(obl_match["name"]))) if obl_match else 0
    if sub_match and sub_spec >= obl_spec:
        return "subscription", sub_match
    if obl_match:
        return "obligation", obl_match
    return None, None


def _soft_delete(db: Any, kind: str, row_id: int) -> bool:
    table = "subscriptions" if kind == "subscription" else "obligations"
    try:
        execute(
            db,
            f"UPDATE {table} SET is_active = 0, "
            f"updated_at = datetime('now') WHERE id = ?",
            (row_id,),
        )
    except Exception:
        logger.exception("Failed to soft-delete %s id=%s", kind, row_id)
        return False
    return True


def _apply_update(
    db: Any, kind: str, row: dict[str, Any], amount: float
) -> dict[str, Any] | None:
    if kind == "subscription":
        old = row.get("amount")
        if old is not None and float(old) == amount:
            return None
        try:
            execute(
                db,
                "UPDATE subscriptions SET amount = ?, source = 'chat', "
                "updated_at = datetime('now') WHERE id = ?",
                (amount, int(row["id"])),
            )
        except Exception:
            logger.exception(
                "Failed to update subscription id=%s", row.get("id")
            )
            return None
        return {
            "type": "subscription",
            "id": int(row["id"]),
            "name": str(row.get("name") or ""),
            "action": "updated",
            "field": "amount",
            "old_value": float(old) if old is not None else None,
            "new_value": amount,
            "currency": str(row.get("currency") or "EUR"),
        }

    old = row.get("monthly_payment")
    if old is not None and float(old) == amount:
        return None
    try:
        execute(
            db,
            "UPDATE obligations SET monthly_payment = ?, source = 'chat', "
            "updated_at = datetime('now') WHERE id = ?",
            (amount, int(row["id"])),
        )
    except Exception:
        logger.exception("Failed to update obligation id=%s", row.get("id"))
        return None
    return {
        "type": "obligation",
        "id": int(row["id"]),
        "name": str(row.get("name") or ""),
        "action": "updated",
        "field": "monthly_payment",
        "old_value": float(old) if old is not None else None,
        "new_value": amount,
        "currency": "EUR",
    }


def apply_recurring_corrections(
    db: Any, message: str
) -> list[dict[str, Any]]:
    """Detect chat-side edits to recurring items and apply them to the DB.

    Supports two intents on the user's last message:
      • Price correction → updates `subscriptions.amount` /
        `obligations.monthly_payment`.
      • Deletion         → soft-deletes (sets `is_active = 0`) when the
        message contains an explicit removal verb plus a name match.

    Returns a list of descriptors with an `action` of `"updated"` or
    `"deleted"`.
    """
    text = (message or "").strip()
    if not text:
        return []

    msg_stems = {_stem(t) for t in _tokenize(text)}
    if not msg_stems:
        return []

    is_delete = bool(_DELETE_INTENT_RE.search(text))
    amount = None if is_delete else _pick_correction_amount(text)
    if not is_delete and amount is None:
        return []

    subs, obls = _load_rows(db)
    kind, chosen = _choose(subs, obls, msg_stems)
    if not chosen or not kind:
        return []

    if is_delete:
        if not _soft_delete(db, kind, int(chosen["id"])):
            return []
        return [{
            "type": kind,
            "id": int(chosen["id"]),
            "name": str(chosen.get("name") or ""),
            "action": "deleted",
        }]

    assert amount is not None
    updated = _apply_update(db, kind, chosen, amount)
    return [updated] if updated else []


def format_confirmation(updates: list[dict[str, Any]]) -> str:
    """Markdown footer the chat router appends to the LLM response."""
    if not updates:
        return ""
    lines: list[str] = []
    for u in updates:
        name = u.get("name") or "?"
        action = str(u.get("action") or "updated").lower()
        if action == "deleted":
            lines.append(f"_Удалено: {name}_")
            continue
        currency = u.get("currency") or "EUR"
        symbol = "€" if currency.upper() == "EUR" else f"{currency} "
        new = u.get("new_value")
        try:
            new_str = f"{symbol}{float(new):.2f}"
        except (TypeError, ValueError):
            new_str = f"{symbol}?"
        old = u.get("old_value")
        if old is not None:
            try:
                old_str = f"{symbol}{float(old):.2f}"
                lines.append(f"_Обновлено: {name} {old_str} → {new_str}_")
                continue
            except (TypeError, ValueError):
                pass
        lines.append(f"_Обновлено: {name} → {new_str}_")
    return "\n\n" + "\n".join(lines)
