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


def parse_amount_from_text(text: str | None) -> float | None:
    if not text:
        return None
    for pattern in _AMOUNT_PATTERNS:
        match = pattern.search(text)
        if not match:
            continue
        raw = match.group(1).replace(" ", "").replace(",", ".")
        try:
            return round(float(raw), 2)
        except ValueError:
            continue
    return None


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
