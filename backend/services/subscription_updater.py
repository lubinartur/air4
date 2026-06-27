"""Detect and apply price corrections to subscriptions/obligations.

The chat pipeline calls :func:`detect_recurring_corrections` on the user's
message to build pending actions (price updates and delete commands).
Writes happen only when the user confirms via
``POST /api/chat/confirm-action`` → :func:`apply_pending_recurring_action`.

Delete commands (``удали Netflix``, ``delete Spotify``, …) use fuzzy name
matching (≥0.5 similarity). Price updates require an explicit new amount.
"""

from __future__ import annotations

import difflib
import logging
import re
from typing import Any

from database import execute, fetch_all, fetch_one

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

# Exact delete verbs — word-boundary match only (no stem wildcards).
_DELETE_VERB = (
    r"удали|удалить|убери|убрать|отмени|отменить|"
    r"cancel|delete|remove"
)
_DELETE_COMMAND_RE = re.compile(
    rf"(?:^|(?<=\s))(?P<verb>{_DELETE_VERB})(?=\s)\s+"
    rf"(?P<name>.+)$",
    re.IGNORECASE,
)
# Direct negation before a delete verb: «не удали», «не удалить».
_DELETE_VERB_NEGATED_RE = re.compile(
    rf"(?:^|\s)не\s+(?:{_DELETE_VERB})\b",
    re.IGNORECASE,
)
# Imperative negation: «не удаляй», «не убирай».
_DELETE_IMPERATIVE_NEGATED_RE = re.compile(
    r"(?:^|\s)не\s+(?:удаляй|убирай|отменяй)\b",
    re.IGNORECASE,
)
# Modal negation before/after verb: «не можем удалить», «удалить не сможем».
_DELETE_MODAL_NEGATED_RE = re.compile(
    r"(?:^|\s)не\s+(?:могу|можем|можешь|сможем|будем|станем|надо|нужно|стоит)\b"
    r"|"
    rf"\b(?:{_DELETE_VERB})\s+не\s+"
    r"(?:могу|можем|можешь|сможем|будем|станем|надо|нужно|стоит)\b",
    re.IGNORECASE,
)
_DELETE_MIN_NAME_LEN = 3
_DELETE_MIN_SIMILARITY = 0.5
_DELETE_CONFIDENCE = 0.85

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

# Russian colloquial transliterations → canonical Latin service names.
# Both sides of a match are normalized to Latin so «нетфликс» ↔ «Netflix».
_TRANSLIT_RU_TO_LAT: tuple[tuple[str, str], ...] = (
    ("нетфликс", "netflix"),
    ("спотифай", "spotify"),
    ("клод", "claude"),
    ("гугл", "google"),
    ("эпл", "apple"),
    ("телеграм", "telegram"),
    ("ютуб", "youtube"),
    ("гитхаб", "github"),
    ("мидджорни", "midjourney"),
)
_TRANSLIT_LAT_CANONICAL: frozenset[str] = frozenset(
    lat for _, lat in _TRANSLIT_RU_TO_LAT
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


def _normalize_for_match(text: str) -> str:
    """Lowercase, strip punctuation, map RU transliterations → Latin canonical."""
    s = _normalize(text)
    s = re.sub(r"\s+", " ", s).strip()
    for ru, lat in _TRANSLIT_RU_TO_LAT:
        s = re.sub(rf"(?<!\w){re.escape(ru)}(?!\w)", lat, s)
    # Latin DB names (Netflix, netflix) → same canonical token as RU input.
    for lat in _TRANSLIT_LAT_CANONICAL:
        s = re.sub(rf"(?<!\w){re.escape(lat)}(?!\w)", lat, s)
    return s


def _tokenize(text: str) -> list[str]:
    return [
        t for t in _normalize(text).split()
        if len(t) >= _MIN_TOKEN_LEN and t not in _STOPWORDS
    ]


def _tokenize_for_match(text: str) -> list[str]:
    """Tokenize after transliteration normalization for name matching."""
    return [
        t for t in _normalize_for_match(text).split()
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
        None, _normalize_for_match(a), _normalize_for_match(b)
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
    return _tokenize_for_match(name)


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
            "SELECT id, name, amount, currency, is_active FROM subscriptions "
            "WHERE COALESCE(is_active, 1) = 1",
        )
        obls = fetch_all(
            db,
            "SELECT id, name, monthly_payment, is_active FROM obligations "
            "WHERE COALESCE(is_active, 1) = 1",
        )
    except Exception:
        logger.exception("Failed to load recurring rows for match")
        return [], []
    return [dict(r) for r in subs], [dict(r) for r in obls]


def _row_is_active(row: dict[str, Any] | None) -> bool:
    """True when a subscription/obligation row is active (NULL → active)."""
    if not row:
        return False
    val = row.get("is_active")
    if val is None:
        return True
    try:
        return int(val) == 1
    except (TypeError, ValueError):
        return bool(val)


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


def _is_negated_delete_message(text: str) -> bool:
    """True when the message negates or questions deletion intent."""
    clean = (text or "").strip()
    if not clean:
        return False
    if _DELETE_VERB_NEGATED_RE.search(clean):
        return True
    if _DELETE_IMPERATIVE_NEGATED_RE.search(clean):
        return True
    if _DELETE_MODAL_NEGATED_RE.search(clean):
        return True
    return False


def _is_invalid_delete_target(name: str) -> bool:
    """Reject captured tails that are not a real subscription/obligation name."""
    clean = re.sub(r"[.!?,;:]+$", "", (name or "").strip()).strip()
    if len(clean) < _DELETE_MIN_NAME_LEN:
        return True
    lowered = clean.lower()
    if lowered in {"ли", "разве", "правда"}:
        return True
    if re.match(r"^не\s+", lowered):
        return True
    if re.match(
        r"^не\s+(?:сможем|можем|могу|можешь|надо|нужно|стоит|будем)\b",
        lowered,
    ):
        return True
    return False


def _extract_delete_target_name(text: str) -> str | None:
    """Return the subscription/obligation name after a delete verb."""
    clean = (text or "").strip()
    if not clean or _is_negated_delete_message(clean):
        return None

    for match in _DELETE_COMMAND_RE.finditer(clean):
        start = match.start("verb")
        if start > 0 and re.search(r"не\s+$", clean[:start], re.IGNORECASE):
            continue
        name = re.sub(
            r"[.!?,;:]+$", "", (match.group("name") or "").strip()
        ).strip()
        if _is_invalid_delete_target(name):
            continue
        return name
    return None


def _row_fuzzy_match_score(
    target: str, db_name: str, target_stems: set[str], *, min_similarity: float
) -> float:
    """Score how well ``target`` refers to a DB recurring row name."""
    if _is_junk_recurring_name(db_name):
        return 0.0
    sim = _name_similarity(target, db_name)
    if sim >= min_similarity:
        return sim
    if _full_name_match(db_name, target_stems):
        return max(sim, 0.8)
    name_tokens = _name_tokens(db_name)
    if not name_tokens:
        return 0.0
    matched = sum(1 for t in name_tokens if _stem(t) in target_stems)
    ratio = matched / len(name_tokens)
    if ratio >= min_similarity:
        return max(sim, ratio)
    return 0.0


def _pick_best_fuzzy(
    subs: list[dict[str, Any]],
    obls: list[dict[str, Any]],
    target: str,
    target_stems: set[str],
    *,
    min_similarity: float,
) -> tuple[str | None, dict[str, Any] | None]:
    """Pick the best subscription/obligation row for a delete command."""
    best_kind: str | None = None
    best_row: dict[str, Any] | None = None
    best_score = 0.0
    best_specificity = 0

    for kind, pool in (("subscription", subs), ("obligation", obls)):
        for row in pool:
            name = str(row.get("name") or "")
            score = _row_fuzzy_match_score(
                target, name, target_stems, min_similarity=min_similarity
            )
            if score < min_similarity:
                continue
            specificity = len(_name_tokens(name))
            if score > best_score or (
                score == best_score and specificity > best_specificity
            ):
                best_kind = kind
                best_row = row
                best_score = score
                best_specificity = specificity

    return best_kind, best_row


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
        symbol = "€" if currency.upper() == "EUR" else f"{currency} "
        if old_value is not None:
            try:
                amount_str = f"{symbol}{float(old_value):.2f}"
                return f"Удалить {name} ({amount_str}/мес)"
            except (TypeError, ValueError):
                pass
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
        if old is not None:
            try:
                data["amount"] = float(old)
            except (TypeError, ValueError):
                pass
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


def _detect_delete_command(
    db: Any, message: str
) -> list[dict[str, Any]]:
    """Detect delete commands like ``удали Netflix`` with fuzzy name matching."""
    text = (message or "").strip()
    if not text or _is_negated_delete_message(text):
        return []

    target_name = _extract_delete_target_name(text)
    if not target_name:
        return []

    match_text = target_name
    match_stems = {_stem(t) for t in _tokenize_for_match(match_text)}
    if not match_stems:
        return []

    subs, obls = _load_rows(db)
    kind, chosen = _pick_best_fuzzy(
        subs,
        obls,
        match_text,
        match_stems,
        min_similarity=_DELETE_MIN_SIMILARITY,
    )
    if not chosen or not kind:
        logger.info(
            "delete command skipped (no DB match): target=%r message=%r",
            match_text[:80],
            text[:120],
        )
        return []

    name = str(chosen.get("name") or "")
    if not _message_matches_recurring_name(text, name, match_stems):
        logger.info(
            "delete command skipped (low name confidence): name=%r message=%r",
            name,
            text[:120],
        )
        return []

    if not _row_is_active(chosen):
        logger.info(
            "delete command skipped (inactive): name=%r message=%r",
            name,
            text[:120],
        )
        return []

    return [
        _build_correction_pending(
            kind=kind,
            chosen=chosen,
            is_delete=True,
            amount=None,
            confidence=_DELETE_CONFIDENCE,
        )
    ]


def _detect_price_update(
    db: Any, message: str
) -> list[dict[str, Any]]:
    """Detect price corrections from the user's message."""
    text = (message or "").strip()
    if not text:
        return []

    msg_stems = {_stem(t) for t in _tokenize_for_match(text)}
    if not msg_stems:
        return []

    amount = _pick_correction_amount(text)
    if amount is None:
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

    if old is not None and float(old) == amount:
        return []

    if not _row_is_active(chosen):
        logger.info(
            "recurring correction skipped (inactive): name=%r message=%r",
            name,
            text[:120],
        )
        return []

    specificity = len(_name_tokens(name))
    confidence = min(0.98, 0.72 + 0.06 * specificity)

    return [
        _build_correction_pending(
            kind=kind,
            chosen=chosen,
            is_delete=False,
            amount=amount,
            confidence=confidence,
        )
    ]


def _detect_from_user_message(
    db: Any, message: str
) -> list[dict[str, Any]]:
    """Detect recurring corrections from the user's message."""
    delete_pending = _detect_delete_command(db, message)
    if delete_pending:
        return delete_pending
    return _detect_price_update(db, message)


def detect_recurring_corrections(
    db: Any, message: str
) -> list[dict[str, Any]]:
    """Detect chat-side edits to recurring items from the user's message only.

    Does not write to the database — call :func:`apply_pending_recurring_action`
    after the user confirms via ``POST /api/chat/confirm-action``.
    """
    return _detect_from_user_message(db, message)


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
        table = "subscriptions" if kind == "subscription" else "obligations"
        row = fetch_one(
            db,
            f"SELECT is_active FROM {table} WHERE id = ?",
            (int(row_id),),
        )
        if not row or not _row_is_active(row):
            return None
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
    if not row or not _row_is_active(row):
        return None
    return _apply_update(db, kind, row, float(amount))


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
