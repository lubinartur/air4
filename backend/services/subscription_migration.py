"""One-time migration: backfill `subscriptions` from `user_facts`.

Older versions of the app stored subscriptions only as text in `user_facts`
(e.g. `has_spotify_family: "Семейный пакет за 15€/мес"` or aggregate facts
like `uses_ai_tools: "ChatGPT Plus, Midjourney, Claude"`). The subscriptions
table is now the source of truth, so this script scans `user_facts` two
ways:

  1. Key-based   — facts whose key explicitly names a known service
                   (e.g. `has_spotify_family`).
  2. Value-based — facts whose key suggests a subscription bucket and
                   whose value text mentions one or more known brands
                   (e.g. `uses_ai_tools: "ChatGPT, Midjourney, Claude"`).

Idempotent: rows are matched by canonical name (case-insensitive), so
re-running the migration never duplicates entries.
"""

from __future__ import annotations

import logging
import re
import sqlite3
from typing import Any

from database import execute, fetch_all, fetch_one
from services.fact_extractor import (
    _matched_known_service,
    canonical_subscription_name,
    is_blacklisted_subscription_name,
    is_subscription_key,
)
from services.finance_facts import parse_amount_from_text

logger = logging.getLogger("subscription_migration")

# Keys that suggest an aggregate subscription / usage / plan bucket. We
# only value-scan facts whose key matches this — scanning every fact value
# would generate too many false positives from biographical text.
_VALUE_SCAN_KEY_RE = re.compile(
    r"(subscription|plan|tool|service|^use[sd]?_|_use[sd]?_|^uses?$)",
    re.IGNORECASE,
)

# Heuristic negation guard so facts like "Не пользуется Duolingo, убрал из
# подписок" don't create rows.
_NEGATION_RE = re.compile(
    r"(не\s+пользу|не\s+использ|не\s+подпис|убрал|отказал|отписал|"
    r"больше\s+не|removed?|cancell?ed|stopped|no\s+longer)",
    re.IGNORECASE,
)

# (regex, canonical display name). `\b` is Unicode-aware in Python 3, so
# Cyrillic surrounding text doesn't break the boundaries.
_VALUE_BRAND_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bchat\s*gpt(?:\s*plus)?\b", re.IGNORECASE), "ChatGPT"),
    (re.compile(r"\bmidjourney\b", re.IGNORECASE), "Midjourney"),
    (re.compile(r"\bclaude\b", re.IGNORECASE), "Claude"),
    (re.compile(r"\bnetflix\b", re.IGNORECASE), "Netflix"),
    (re.compile(r"\bspotify\b", re.IGNORECASE), "Spotify"),
    (re.compile(r"\bi[\s_]*cloud\b", re.IGNORECASE), "iCloud"),
    (re.compile(r"\bgoogle\s+drive\b", re.IGNORECASE), "Google Drive"),
    (re.compile(r"\bgoogle\s+one\b", re.IGNORECASE), "Google One"),
    (re.compile(r"\bdropbox\b", re.IGNORECASE), "Dropbox"),
    (re.compile(r"\bamazon\s+prime\b", re.IGNORECASE), "Amazon Prime"),
    (re.compile(r"\bduolingo\b", re.IGNORECASE), "Duolingo"),
    (re.compile(r"\bapple\s+music\b", re.IGNORECASE), "Apple Music"),
    (re.compile(r"\byoutube\s+premium\b", re.IGNORECASE), "YouTube Premium"),
    (re.compile(r"\byoutube\s+music\b", re.IGNORECASE), "YouTube Music"),
    (re.compile(r"\bgithub\s+pro\b", re.IGNORECASE), "GitHub Pro"),
    (re.compile(r"\bgithub\s+copilot\b", re.IGNORECASE), "GitHub Copilot"),
    (re.compile(r"\bfigma\b", re.IGNORECASE), "Figma"),
    (re.compile(r"\bnotion\b", re.IGNORECASE), "Notion"),
    (re.compile(r"\blinear\b", re.IGNORECASE), "Linear"),
    (re.compile(r"\badobe(?:\s+creative\s+cloud)?\b", re.IGNORECASE), "Adobe"),
    (re.compile(r"\bsetapp\b", re.IGNORECASE), "Setapp"),
]


def _key_eligible_by_known_service(fact: dict[str, Any]) -> bool:
    key = str(fact.get("key") or "")
    if not is_subscription_key(key):
        return False
    return _matched_known_service(key) is not None


def _key_eligible_for_value_scan(fact: dict[str, Any]) -> bool:
    key = str(fact.get("key") or "")
    if not key:
        return False
    return bool(_VALUE_SCAN_KEY_RE.search(key))


def _is_negated(value: str) -> bool:
    return bool(_NEGATION_RE.search(value or ""))


def _extract_brands_from_value(value: str) -> list[str]:
    """Return canonical display names for every brand mentioned in `value`,
    preserving the order of first appearance."""
    found: list[str] = []
    seen: set[str] = set()
    for pattern, display in _VALUE_BRAND_PATTERNS:
        if pattern.search(value):
            key = display.lower()
            if key not in seen:
                seen.add(key)
                found.append(display)
    return found


def _row_exists(conn: sqlite3.Connection, name: str) -> bool:
    row = fetch_one(
        conn,
        "SELECT id FROM subscriptions WHERE LOWER(name) = LOWER(?) LIMIT 1",
        (name,),
    )
    return row is not None


def _insert_subscription(
    conn: sqlite3.Connection, name: str, amount: float | None
) -> bool:
    try:
        execute(
            conn,
            """
            INSERT INTO subscriptions
                (name, amount, currency, category, is_active, source,
                 created_at, updated_at)
            VALUES (?, ?, 'EUR', 'other', 1, 'migrated',
                    datetime('now'), datetime('now'))
            """,
            (name, amount),
        )
        return True
    except Exception:
        logger.exception("Failed to insert subscription %s", name)
        return False


def migrate_facts_to_subscriptions(
    conn: sqlite3.Connection,
) -> dict[str, int]:
    """Insert missing subscription rows derived from `user_facts`.

    Returns a small report: ``{scanned, inserted, skipped_existing,
    skipped_ineligible, skipped_negated}``.
    """
    report = {
        "scanned": 0,
        "inserted": 0,
        "skipped_existing": 0,
        "skipped_ineligible": 0,
        "skipped_negated": 0,
    }

    try:
        facts = fetch_all(
            conn, "SELECT key, value FROM user_facts WHERE key IS NOT NULL"
        )
    except Exception:
        logger.exception("Failed to read user_facts during migration")
        return report

    inserted_names: set[str] = set()

    def _try_insert(name: str, amount: float | None) -> str:
        if not name or name == "Unnamed":
            return "ineligible"
        # Reject system/meta descriptions ("Manages Subscriptions And Loans",
        # "Tracks Subscriptions And Obligations", "Recurring Subscriptions"…)
        # that get title-cased from aggregate fact keys with no real brand.
        if is_blacklisted_subscription_name(name):
            logger.info("Subscription migration: skipping blacklisted name %r", name)
            return "ineligible"
        name_lc = name.lower()
        if name_lc in inserted_names or _row_exists(conn, name):
            inserted_names.add(name_lc)
            return "existing"
        if _insert_subscription(conn, name, amount):
            inserted_names.add(name_lc)
            return "inserted"
        return "ineligible"

    for raw in facts:
        report["scanned"] += 1
        fact = dict(raw)
        value = str(fact.get("value") or "")

        # Pass 1 — key explicitly names a known service.
        if _key_eligible_by_known_service(fact):
            if _is_negated(value):
                report["skipped_negated"] += 1
                continue
            name = canonical_subscription_name(str(fact.get("key") or ""))
            amount = parse_amount_from_text(value)
            outcome = _try_insert(name, amount)
            report[
                {
                    "inserted": "inserted",
                    "existing": "skipped_existing",
                    "ineligible": "skipped_ineligible",
                }[outcome]
            ] += 1
            continue

        # Pass 2 — aggregate-style key, scan the value for brand mentions.
        if _key_eligible_for_value_scan(fact):
            if _is_negated(value):
                report["skipped_negated"] += 1
                continue
            brands = _extract_brands_from_value(value)
            if not brands:
                report["skipped_ineligible"] += 1
                continue
            # When a value lists several brands we usually can't attribute
            # the parsed amount to a specific one, so prefer NULL over a
            # misleading guess. If exactly one brand is present we keep the
            # amount.
            single_amount = (
                parse_amount_from_text(value) if len(brands) == 1 else None
            )
            inserted_any = existing_any = False
            for brand in brands:
                outcome = _try_insert(brand, single_amount)
                if outcome == "inserted":
                    inserted_any = True
                elif outcome == "existing":
                    existing_any = True
            if inserted_any:
                report["inserted"] += 1
            elif existing_any:
                report["skipped_existing"] += 1
            else:
                report["skipped_ineligible"] += 1
            continue

        report["skipped_ineligible"] += 1

    if report["inserted"] > 0:
        logger.info(
            "Subscription migration: %d new row(s) from %d fact(s)",
            report["inserted"],
            report["scanned"],
        )
    return report
