from __future__ import annotations

import re
from typing import Any

_AMOUNT_PATTERNS = (
    re.compile(r"€\s*([\d][\d\s]*(?:[.,]\d+)?)", re.IGNORECASE),
    re.compile(r"([\d][\d\s]*(?:[.,]\d+)?)\s*€", re.IGNORECASE),
    re.compile(r"([\d][\d\s]*(?:[.,]\d+)?)\s*(?:EUR|eur)\b", re.IGNORECASE),
    re.compile(r"([\d][\d\s]*(?:[.,]\d+)?)\s*евро", re.IGNORECASE),
)

_SUBSCRIPTION_KEY_TERMS = (
    "subscription",
    "подписк",
    "netflix",
    "spotify",
)
_SUBSCRIPTION_VALUE_TERMS = (
    "подписка",
    "€/мес",
    "eur/month",
)

_OBLIGATION_KEY_TERMS = (
    "loan",
    "credit",
    "кредит",
    "ипотек",
    "аренд",
    "obligation",
)


def _parse_amount_raw(raw: str) -> float | None:
    try:
        return round(float(raw.replace(" ", "").replace(",", ".")), 2)
    except (TypeError, ValueError):
        return None


def parse_amount_from_text(text: str | None) -> float | None:
    if not text:
        return None
    for pattern in _AMOUNT_PATTERNS:
        match = pattern.search(text)
        if not match:
            continue
        val = _parse_amount_raw(match.group(1))
        if val is not None and val > 0:
            return val
    return None


def parse_all_amounts_from_text(text: str | None) -> list[float]:
    """Every currency amount in document order (deduped)."""
    if not text:
        return []
    seen: set[float] = set()
    out: list[float] = []
    for pattern in _AMOUNT_PATTERNS:
        for match in pattern.finditer(text):
            val = _parse_amount_raw(match.group(1))
            if val is not None and val > 0 and val not in seen:
                seen.add(val)
                out.append(val)
    return out


# Atomic-ish number capture: leading digits, optional space-thousand
# groups (1 335), optional decimal, then a word boundary. The `\b` is
# critical — without it Python's regex backtracking would slice
# "10 платежей" into "1" (so it could satisfy a "not followed by
# платеж" lookahead). Forcing the boundary commits the engine to the
# full number before disambiguation runs.
_AMOUNT_BODY = r"(\d+(?:[\s\u00A0]\d{3})*(?:[.,]\d+)?)\b"
_AMOUNT_TRAIL = rf"{_AMOUNT_BODY}\s*(?:€|EUR|eur|евро)?"
_AMOUNT_LEAD = rf"(?:€|EUR|eur|евро)?\s*{_AMOUNT_BODY}"

# "€111/мес", "111 евро в месяц", "ежемесячный платёж €111.25",
# "Kuumakse 111,25" (Estonian monthly payment), "monthly payment".
_MONTHLY_AMOUNT_RE = re.compile(
    rf"(?:"
    rf"{_AMOUNT_TRAIL}\s*(?:в\s*месяц|/\s*мес|ежемесячно|per\s*month)"
    rf"|(?:ежемесячный\s+платеж|ежемесячный\s+платёж|месячный\s+платеж|"
    rf"kuumakse|monthly\s+payment|payment\s+per\s+month)\s*[:\s—–-]*\s*{_AMOUNT_LEAD}"
    rf")",
    re.IGNORECASE,
)
_REMAINING_AMOUNT_RE = re.compile(
    rf"(?:осталось|остаётся|остается|остаток|remaining|balance\s+left|left)"
    rf"\s*[:\s—–-]*\s*{_AMOUNT_LEAD}"
    # Negative lookahead: refuse "10 платежей / месяцев / payments / months"
    # — those are counts, not currency. Without this, "Осталось: 10
    # платежей" persists as €10 remaining.
    r"(?!\s*(?:платеж(?:а|ей|ам|ами)?|месяц(?:а|ев|ам|ами)?|"
    r"payments?|months?))",
    re.IGNORECASE,
)
_TOTAL_AMOUNT_RE = re.compile(
    rf"(?:всего|total|сумма|на\s+сумму|principal|summa)"
    rf"\s*[:\s—–-]*\s*{_AMOUNT_LEAD}",
    re.IGNORECASE,
)
_PAID_AMOUNT_RE = re.compile(
    rf"(?:оплачено|уплачено|выплачено|paid|makstud)"
    rf"\s*[:\s—–-]*\s*{_AMOUNT_LEAD}",
    re.IGNORECASE,
)


def parse_obligation_amounts(text: str | None) -> dict[str, float | None]:
    """Extract monthly / remaining / total from obligation narratives.

    Used by fact_extractor and obligation_from_chat so installment
  plans like "€111/мес, осталось €1335" map to the right columns.
    """
    if not text:
        return {
            "monthly_payment": None,
            "remaining_amount": None,
            "total_amount": None,
        }
    monthly: float | None = None
    remaining: float | None = None
    total: float | None = None
    paid: float | None = None

    m = _MONTHLY_AMOUNT_RE.search(text)
    if m:
        monthly = _parse_amount_raw(next(g for g in m.groups() if g))

    m = _REMAINING_AMOUNT_RE.search(text)
    if m:
        remaining = _parse_amount_raw(m.group(1))

    m = _TOTAL_AMOUNT_RE.search(text)
    if m:
        total = _parse_amount_raw(m.group(1))

    m = _PAID_AMOUNT_RE.search(text)
    if m:
        paid = _parse_amount_raw(m.group(1))

    all_amounts = parse_all_amounts_from_text(text)
    if not total and all_amounts:
        # Single large amount with no monthly marker → treat as principal.
        if monthly is None and len(all_amounts) == 1:
            total = all_amounts[0]
        elif monthly is not None:
            for amt in all_amounts:
                if amt != monthly:
                    total = amt
                    break
        elif remaining is not None:
            for amt in all_amounts:
                if amt != remaining:
                    total = amt
                    break

    # Compute remaining when the source only gave us total + paid.
    if remaining is None and total is not None and paid is not None and total > paid > 0:
        remaining = round(total - paid, 2)

    if remaining is None and total is not None and monthly is not None:
        # Sometimes the only two numbers are monthly + balance left.
        for amt in all_amounts:
            if amt not in (monthly, total):
                remaining = amt
                break
        if remaining is None and total > monthly:
            remaining = total

    return {
        "monthly_payment": monthly,
        "remaining_amount": remaining,
        "total_amount": total,
    }


def key_to_display_name(key: str) -> str:
    return " ".join(part.capitalize() for part in key.replace("-", "_").split("_") if part)


def _matches_terms(haystack: str, terms: tuple[str, ...]) -> bool:
    lower = haystack.lower()
    return any(term in lower for term in terms)


def _row_matches_subscription(row: dict[str, Any]) -> bool:
    key = str(row.get("key") or "")
    value = str(row.get("value") or "")
    if _matches_terms(key, _SUBSCRIPTION_KEY_TERMS):
        return True
    return _matches_terms(value, _SUBSCRIPTION_VALUE_TERMS)


def _row_matches_obligation(row: dict[str, Any]) -> bool:
    key = str(row.get("key") or "")
    return _matches_terms(key, _OBLIGATION_KEY_TERMS)


def subscription_from_row(row: dict[str, Any]) -> dict[str, Any]:
    key = str(row.get("key") or "")
    raw = str(row.get("value") or "")
    return {
        "key": key,
        "name": key_to_display_name(key),
        "amount": parse_amount_from_text(raw),
        "currency": "EUR",
        "raw": raw,
    }


def obligation_from_row(row: dict[str, Any]) -> dict[str, Any]:
    key = str(row.get("key") or "")
    raw = str(row.get("value") or "")
    amount = parse_amount_from_text(raw)
    return {
        "key": key,
        "name": key_to_display_name(key),
        "amount": amount,
        "monthly_payment": amount,
        "raw": raw,
    }


def filter_subscription_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [subscription_from_row(r) for r in rows if _row_matches_subscription(r)]


def filter_obligation_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [obligation_from_row(r) for r in rows if _row_matches_obligation(r)]
