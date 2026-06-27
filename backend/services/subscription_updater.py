"""Detect and apply price corrections to subscriptions/obligations.

The chat pipeline calls :func:`detect_recurring_corrections` after the LLM
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

import difflib
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

# Names that are amounts, cadence labels, or other non-service junk in DB.
_JUNK_NAME_LITERALS = frozenset({
    "monthly", "месяц", "мес", "payment", "payments", "платёж", "платеж",
    "subscription", "подписка", "obligation", "обязательство",
})
_CURRENCY_MONTHLY_NAME_RE = re.compile(
    r"^€?\s*\d[\d\s.,]*\s*(?:/\s*мес\.?|per\s*month|monthly)\.?$",
    re.IGNORECASE,
)
_PURE_AMOUNT_NAME_RE = re.compile(
    r"^€?\s*[\d][\d\s.,]*(?:\s*(?:€|eur|евро))?\s*$",
    re.IGNORECASE,
)
_STARTS_WITH_CURRENCY_RE = re.compile(r"^\s*[€$]")
_MAX_RECURRING_NAME_LEN = 50
# Parentheses enclosing amounts, e.g. "(iPhone 111.25, Rent €700, …)".
_PARENS_WITH_AMOUNT_RE = re.compile(
    r"\([^)]*(?:€\s*[\d][\d\s.,]*|[\d][\d\s.,]*\s*€|[\d][\d\s.,]{2,})",
    re.IGNORECASE,
)
_EURO_IN_TEXT_RE = re.compile(r"€\s*[\d]", re.IGNORECASE)
_DOLLAR_IN_TEXT_RE = re.compile(r"\$\s*[\d]")

# Assistant-stated price updates: "Обновляю Netflix: €12 → €15".
_ASSISTANT_UPDATE_VERB_RE = (
    r"(?:обновляю|обновил[аи]?|меняю|изменяю|ставлю|устанавливаю|"
    r"updating|updated|setting|changing)\s+"
)
_ASSISTANT_COLON_PRICE_RE = re.compile(
    rf"(?:{_ASSISTANT_UPDATE_VERB_RE})?"
    r"(?P<name>[^:\n€$]+?)"
    r"\s*:\s*"
    r"(?:€|EUR|\$)?\s*(?P<old>[\d][\d\s.,]*)"
    r"\s*(?:→|->|—|–|to)\s*"
    r"(?:€|EUR|\$)?\s*(?P<new>[\d][\d\s.,]*)",
    re.IGNORECASE,
)
_ASSISTANT_INLINE_PRICE_RE = re.compile(
    r"(?P<name>[A-Za-zА-Яа-яЁё][\w\s.'-]{1,40}?)"
    r"\s+"
    r"(?:€|EUR|\$)?\s*(?P<old>[\d][\d\s.,]*)"
    r"\s*(?:→|->|—|–|to)\s*"
    r"(?:€|EUR|\$)?\s*(?P<new>[\d][\d\s.,]*)",
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


def _is_junk_recurring_name(name: str) -> bool:
    """Reject DB rows whose name is an amount, cadence label, or noise."""
    clean = (name or "").strip()
    if len(clean) < 3:
        return True
    if len(clean) > _MAX_RECURRING_NAME_LEN:
        return True
    if _STARTS_WITH_CURRENCY_RE.match(clean):
        return True
    lowered = clean.lower()
    if lowered in _JUNK_NAME_LITERALS:
        return True
    if _CURRENCY_MONTHLY_NAME_RE.match(clean):
        return True
    if _PURE_AMOUNT_NAME_RE.match(clean):
        return True
    if re.fullmatch(r"[\d\s.,€$]+", clean, re.IGNORECASE):
        return True
    if _PARENS_WITH_AMOUNT_RE.search(clean):
        return True
    euro_hits = len(_EURO_IN_TEXT_RE.findall(clean))
    if euro_hits >= 2:
        return True
    if euro_hits >= 1 and _DOLLAR_IN_TEXT_RE.search(clean):
        return True
    return False


def _name_similarity(a: str, b: str) -> float:
    return difflib.SequenceMatcher(
        None, _normalize(a), _normalize(b)
    ).ratio()


def _message_matches_recurring_name(
    message: str, db_name: str, message_stems: set[str]
) -> bool:
    """Require a recognizable DB name with ≥50% message↔name similarity."""
    if _is_junk_recurring_name(db_name):
        return False
    name_tokens = _name_tokens(db_name)
    if not name_tokens:
        return False
    if _full_name_match(db_name, message_stems):
        return True
    if _name_similarity(message, db_name) >= 0.5:
        return True
    matched = sum(1 for t in name_tokens if _stem(t) in message_stems)
    return matched / len(name_tokens) >= 0.5


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
        if _is_junk_recurring_name(name):
            continue
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


def _build_pending_description(
    kind: str,
    *,
    is_delete: bool,
    name: str,
    old_value: float | None,
    new_value: float | None,
    currency: str = "EUR",
) -> str:
    if is_delete:
        return f"Удалить {name}"
    symbol = "€" if currency.upper() == "EUR" else f"{currency} "
    try:
        new_str = f"{symbol}{float(new_value):.2f}" if new_value is not None else "?"
    except (TypeError, ValueError):
        new_str = "?"
    if old_value is not None:
        try:
            old_str = f"{symbol}{float(old_value):.2f}"
            return f"Обновить {name}: {old_str} → {new_str}"
        except (TypeError, ValueError):
            pass
    return f"Обновить {name} → {new_str}"


def _pending_type(kind: str, is_delete: bool) -> str:
    if is_delete:
        return f"delete_{kind}"
    return f"update_{kind}"


def _build_correction_pending(
    *,
    kind: str,
    chosen: dict[str, Any],
    is_delete: bool,
    amount: float | None,
    old_override: float | None = None,
    confidence: float,
) -> dict[str, Any]:
    name = str(chosen.get("name") or "")
    row_id = int(chosen["id"])
    if kind == "subscription":
        old = old_override if old_override is not None else chosen.get("amount")
        currency = str(chosen.get("currency") or "EUR")
    else:
        old = (
            old_override
            if old_override is not None
            else chosen.get("monthly_payment")
        )
        currency = "EUR"

    action_type = _pending_type(kind, is_delete)
    description = _build_pending_description(
        kind,
        is_delete=is_delete,
        name=name,
        old_value=float(old) if old is not None else None,
        new_value=amount,
        currency=currency,
    )
    data: dict[str, Any] = {
        "kind": kind,
        "id": row_id,
        "name": name,
        "currency": currency,
    }
    if is_delete:
        data["action"] = "deleted"
    else:
        data["action"] = "updated"
        data["amount"] = amount
        data["old_value"] = float(old) if old is not None else None

    return {
        "type": action_type,
        "description": description,
        "confidence": round(confidence, 2),
        "data": data,
    }


def _choose_by_candidate_name(
    subs: list[dict[str, Any]],
    obls: list[dict[str, Any]],
    candidate_name: str,
) -> tuple[str | None, dict[str, Any] | None]:
    clean = re.sub(r"[*_\"'`]+", "", (candidate_name or "").strip())
    if not clean or _is_junk_recurring_name(clean):
        return None, None
    stems = {_stem(t) for t in _tokenize(clean)}
    if not stems:
        return None, None
    kind, chosen = _choose(subs, obls, stems)
    if not chosen or not kind:
        return None, None
    db_name = str(chosen.get("name") or "")
    if _is_junk_recurring_name(db_name):
        return None, None
    if _name_similarity(clean, db_name) < 0.4 and not _full_name_match(
        db_name, stems
    ):
        return None, None
    return kind, chosen


def _detect_from_user_message(
    db: Any, message: str
) -> list[dict[str, Any]]:
    """Detect recurring corrections from the user's message."""
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

    name = str(chosen.get("name") or "")
    if not _message_matches_recurring_name(text, name, msg_stems):
        logger.info(
            "recurring correction skipped (unrecognizable name): name=%r message=%r",
            name,
            text[:120],
        )
        return []

    if kind == "subscription":
        old = chosen.get("amount")
    else:
        old = chosen.get("monthly_payment")

    if not is_delete and old is not None and amount is not None and float(old) == amount:
        return []

    specificity = len(_name_tokens(name))
    confidence = min(0.98, 0.72 + 0.06 * specificity)

    return [
        _build_correction_pending(
            kind=kind,
            chosen=chosen,
            is_delete=is_delete,
            amount=amount,
            confidence=confidence,
        )
    ]


def _detect_from_assistant_text(
    db: Any, assistant_text: str
) -> list[dict[str, Any]]:
    """Detect explicit price updates stated in AIR4's reply."""
    text = (assistant_text or "").strip()
    if not text:
        return []

    subs, obls = _load_rows(db)
    pending: list[dict[str, Any]] = []
    seen: set[tuple[str, int]] = set()

    patterns = (_ASSISTANT_COLON_PRICE_RE, _ASSISTANT_INLINE_PRICE_RE)
    for pattern in patterns:
        for match in pattern.finditer(text):
            raw_name = re.sub(
                r"[*_\"'`]+", "", (match.group("name") or "").strip()
            )
            raw_name = re.sub(
                _ASSISTANT_UPDATE_VERB_RE, "", raw_name, flags=re.IGNORECASE
            ).strip()
            new_amount = _parse_amount(match.group("new") or "")
            old_amount = _parse_amount(match.group("old") or "")
            if not raw_name or new_amount is None:
                continue

            kind, chosen = _choose_by_candidate_name(subs, obls, raw_name)
            if not chosen or not kind:
                continue

            row_id = int(chosen["id"])
            dedupe_key = (kind, row_id)
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)

            if kind == "subscription":
                db_old = chosen.get("amount")
            else:
                db_old = chosen.get("monthly_payment")
            old_f = (
                float(old_amount)
                if old_amount is not None
                else (float(db_old) if db_old is not None else None)
            )
            if old_f is not None and float(old_f) == new_amount:
                continue

            name = str(chosen.get("name") or "")
            specificity = len(_name_tokens(name))
            confidence = min(0.98, 0.82 + 0.05 * specificity)

            pending.append(
                _build_correction_pending(
                    kind=kind,
                    chosen=chosen,
                    is_delete=False,
                    amount=new_amount,
                    old_override=old_f,
                    confidence=confidence,
                )
            )
    return pending


def detect_recurring_corrections(
    db: Any, message: str, assistant_text: str = ""
) -> list[dict[str, Any]]:
    """Detect chat-side edits to recurring items without applying them."""
    results: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()

    for item in (
        *_detect_from_assistant_text(db, assistant_text),
        *_detect_from_user_message(db, message),
    ):
        key = (
            str(item.get("type") or ""),
            str(item.get("description") or ""),
        )
        if key in seen:
            continue
        seen.add(key)
        results.append(item)

    results.sort(
        key=lambda a: float(a.get("confidence") or 0),
        reverse=True,
    )
    return results


def apply_pending_recurring_action(
    db: Any, action: dict[str, Any]
) -> dict[str, Any] | None:
    """Apply a pending recurring correction previously returned by detect."""
    data = action.get("data") or {}
    kind = str(data.get("kind") or "")
    row_id = data.get("id")
    if not kind or row_id is None:
        return None

    action_type = str(action.get("type") or "")
    if action_type.startswith("delete_"):
        if not _soft_delete(db, kind, int(row_id)):
            return None
        return {
            "type": kind,
            "id": int(row_id),
            "name": str(data.get("name") or ""),
            "action": "deleted",
        }

    amount = data.get("amount")
    if amount is None:
        return None
    subs, obls = _load_rows(db)
    pool = subs if kind == "subscription" else obls
    row = next((r for r in pool if int(r.get("id") or 0) == int(row_id)), None)
    if not row:
        row = {
            "id": int(row_id),
            "name": data.get("name"),
            "amount": data.get("old_value"),
            "monthly_payment": data.get("old_value"),
            "currency": data.get("currency") or "EUR",
        }
    return _apply_update(db, kind, row, float(amount))


def apply_recurring_corrections(
    db: Any, message: str, assistant_text: str = ""
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
    pending = detect_recurring_corrections(db, message, assistant_text)
    applied: list[dict[str, Any]] = []
    for item in pending:
        result = apply_pending_recurring_action(db, item)
        if result:
            applied.append(result)
    return applied


def format_confirmation(updates: list[dict[str, Any]]) -> str:
    """Markdown footer the chat router appends to the LLM response."""
    if not updates:
        return ""
    lines: list[str] = []
    for u in updates:
        name = u.get("name") or "?"
        action = str(u.get("action") or "updated").lower()
        kind = str(u.get("type") or "").lower()
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
        if action == "created" and kind == "obligation":
            lines.append(f"_Добавлено в обязательства: {name} — {new_str}_")
            continue
        if action == "created":
            lines.append(f"_Добавлено: {name} — {new_str}_")
            continue
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
