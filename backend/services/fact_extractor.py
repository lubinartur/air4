from __future__ import annotations

import logging
import re
from typing import Any

from database import execute, fetch_all, fetch_one
from services.finance_facts import key_to_display_name, parse_amount_from_text
from services.llm_client import parse_json_array
from services.llm_client_shared import DEFAULT_MODEL, call_claude

logger = logging.getLogger("fact_extractor")

# ---------------------------------------------------------------------------
# Recurring detection — strict matching by KEY only
# ---------------------------------------------------------------------------
# A fact is mirrored to `obligations` or `subscriptions` ONLY when:
#   1. Its key explicitly identifies a recurring financial item
#      (loan, mortgage, rent_payment, known subscription service, etc.).
#   2. A positive € amount can be parsed from the fact value.
#   3. The key does not match any exclusion pattern (work, project, strategy,
#      management, balance, limit, income, ownership, etc.).
#
# We never match on the value text — values often contain stray words like
# "по кредитам" inside unrelated work descriptions, which used to leak
# employment / project facts into the obligations table.

_OBLIGATION_KEY_INCLUDE = re.compile(
    r"("
    r"(^|_)(home|auto|car|motorcycle|apartment|student|consumer)?_?loan(s)?($|_)"
    r"|(^|_)mortgage($|_)"
    r"|^pays_rent"
    r"|^rent_payment(s)?$"
    r"|^rents_(partners|alisa|spouse|wife|husband|family)_"
    r"|^financial_obligation(s)?$"
    r"|^monthly_obligation(s)?$"
    r")",
    re.IGNORECASE,
)

_OBLIGATION_KEY_EXCLUDE = re.compile(
    r"("
    r"strategy|management|approach|style|preference|schedule"
    r"|limit|balance|interest_free|usage"
    r"|work|employment|office|job|project|freelance"
    r"|rents_out|rental_income|owns_|rents_apartment_for_income"
    r"|saving|investment"
    r")",
    re.IGNORECASE,
)

# Known recurring services. We require the service name to be an explicit
# token in the key — substring matches against the value text are not enough.
_KNOWN_SUBSCRIPTION_SERVICES = (
    "netflix",
    "spotify",
    "apple_music",
    "youtube_premium",
    "youtube_music",
    "icloud",
    "google_drive",
    "google_one",
    "dropbox",
    "amazon_prime",
    "duolingo",
    "chatgpt",
    "claude",
    "midjourney",
    "github_pro",
    "github_copilot",
    "figma",
    "notion",
    "linear",
    "vpn",
    "gym_membership",
    "adobe",
    "setapp",
)

_SUBSCRIPTION_KEY_INCLUDE = re.compile(
    r"("
    r"(^|_)subscription(s)?($|_)"
    r"|(^|_)(" + "|".join(_KNOWN_SUBSCRIPTION_SERVICES) + r")($|_)"
    r")",
    re.IGNORECASE,
)

_SUBSCRIPTION_KEY_EXCLUDE = re.compile(
    r"("
    r"strategy|management|approach|style|preference"
    r"|work|employment|project"
    r"|multiple_subscriptions|other_subscriptions|has_subscriptions"
    r")",
    re.IGNORECASE,
)

_MONTHLY_CADENCE = re.compile(
    r"("
    r"в\s*месяц|/\s*мес|ежемесячно|"
    r"monthly|per\s*month|/\s*mo\b|per\s*mo\b|"
    r"every\s*month"
    r")",
    re.IGNORECASE,
)

# Words that signal money flowing IN (rental income, salary, receipts).
# If a value contains any of these we refuse to treat it as an obligation.
_INBOUND_MONEY = re.compile(
    r"("
    r"сдаёт|сдает|сдавать|сдают|"
    r"получает|получаю|получаем|"
    r"зарабатывает|зарабатываю|"
    r"доход|прибыл|выручк|"
    r"rents?\s*out|earns?|earning|"
    r"income|salary|receives?"
    r")",
    re.IGNORECASE,
)


def _has_monthly_cadence(text: str | None) -> bool:
    if not text:
        return False
    return bool(_MONTHLY_CADENCE.search(text))


def _looks_like_inbound_money(text: str | None) -> bool:
    if not text:
        return False
    return bool(_INBOUND_MONEY.search(text))


def _normalize_key(raw: str) -> str | None:
    s = (raw or "").strip().lower().replace(" ", "_")
    s = re.sub(r"[^a-z0-9_]+", "_", s)
    s = re.sub(r"_+", "_", s).strip("_")
    if not s or len(s) > 80:
        return None
    return s


def _build_prompt(user_messages: list[str]) -> str:
    joined = "\n\n".join(f"- {m}" for m in user_messages if m.strip())
    return (
        "Read the user messages below. Extract stable characteristics about THE USER "
        "themselves — habits, preferences, patterns of behavior, constraints, goals "
        "stated as enduring traits.\n\n"
        "A fact is NOT a one-time event "
        '(e.g. "works at night" is a fact; "worked tonight" is not).\n\n'
        "Do NOT extract as facts:\n"
        "- Test messages, nonsense, random words, or gibberish\n"
        "- Names of other people mentioned in conversation (not the user)\n"
        "- Single mentions without enough context to be a stable trait\n"
        "- Opinions about third parties or external projects\n"
        "- Greetings and small talk (hi, thanks, how are you, etc.)\n\n"
        "A valid fact must describe a durable characteristic of THE USER. "
        "If you are unsure — do not extract. Prefer skipping over saving noise.\n\n"
        f"User messages:\n{joined}\n\n"
        "Return ONLY a JSON array (no markdown, no explanation). Each object:\n"
        "{\n"
        '  "key": "snake_case_identifier",\n'
        '  "value": "1-2 sentences in the user\'s language",\n'
        '  "confidence": 0.5-1.0\n'
        "}\n\n"
        "Rules:\n"
        "- key must be snake_case English.\n"
        "- confidence between 0.5 and 1.0.\n"
        "- If there are no facts, return []."
    )


def _first_two_words(key: str) -> tuple[str, ...]:
    parts = [p for p in key.split("_") if p]
    if len(parts) >= 2:
        return (parts[0], parts[1])
    if parts:
        return (parts[0],)
    return ()


def _find_similar_key(db: Any, key: str) -> str | None:
    """Find an existing fact key whose first two underscore-segments match."""
    prefix = _first_two_words(key)
    if len(prefix) < 2:
        return None
    for row in fetch_all(db, "SELECT key FROM user_facts"):
        existing_key = str(row["key"])
        if existing_key == key:
            continue
        if _first_two_words(existing_key) == prefix:
            return existing_key
    return None


def _upsert_fact(db: Any, fact: dict[str, Any]) -> dict[str, Any] | None:
    key = fact["key"]
    existing = fetch_one(
        db,
        "SELECT id, confidence FROM user_facts WHERE key = ?",
        (key,),
    )
    target_key = key
    if existing is None:
        similar = _find_similar_key(db, key)
        if similar:
            target_key = similar
            existing = fetch_one(
                db,
                "SELECT id, confidence FROM user_facts WHERE key = ?",
                (target_key,),
            )

    if existing is not None:
        old_conf = float(existing.get("confidence") or 0)
        if fact["confidence"] < old_conf:
            return fetch_one(
                db, "SELECT * FROM user_facts WHERE key = ?", (target_key,)
            )
        execute(
            db,
            """
            UPDATE user_facts
            SET value = ?, confidence = ?, source = 'chat',
                updated_at = datetime('now')
            WHERE key = ?
            """,
            (fact["value"], fact["confidence"], target_key),
        )
    else:
        execute(
            db,
            """
            INSERT INTO user_facts (key, value, confidence, source, updated_at)
            VALUES (?, ?, ?, 'chat', datetime('now'))
            """,
            (fact["key"], fact["value"], fact["confidence"]),
        )
        target_key = fact["key"]

    row = fetch_one(db, "SELECT * FROM user_facts WHERE key = ?", (target_key,))
    return dict(row) if row is not None else None


def _normalize_fact(raw: dict[str, Any]) -> dict[str, Any] | None:
    key = _normalize_key(str(raw.get("key") or ""))
    value = str(raw.get("value") or "").strip()
    if not key or not value:
        return None

    try:
        confidence = float(raw.get("confidence", 0.8))
    except (TypeError, ValueError):
        confidence = 0.8
    confidence = max(0.5, min(1.0, confidence))

    return {"key": key, "value": value, "confidence": confidence}


def is_subscription_key(key: str) -> bool:
    """Public predicate: does a user_facts key describe a subscription
    that should live in the `subscriptions` table?
    """
    if not key:
        return False
    if _SUBSCRIPTION_KEY_EXCLUDE.search(key):
        return False
    return bool(_SUBSCRIPTION_KEY_INCLUDE.search(key))


# Broader pattern used by the prompt-builder to scrub *any* subscription-
# related fact (including aggregate keys like `has_subscriptions` and
# `uses_ai_tools`) so the LLM only ever sees subscription data from the
# authoritative `subscriptions` table.
_SUBSCRIPTION_RELATED_KEY_RE = re.compile(
    r"("
    r"subscription(s)?|"
    r"(^|_)ai_tools($|_)|"
    r"(^|_)streaming($|_)|"
    r"(^|_)(" + "|".join(_KNOWN_SUBSCRIPTION_SERVICES) + r")($|_)"
    r")",
    re.IGNORECASE,
)


def is_subscription_related_key(key: str) -> bool:
    """True for any fact key whose subject overlaps with the subscriptions
    table — direct service keys, aggregate buckets, or "ai_tools"-style
    multi-service lists. Strategy/management/preference keys are kept
    because they carry behavioural context, not pricing.
    """
    if not key:
        return False
    if re.search(
        r"strategy|management|approach|style|preference",
        key,
        re.IGNORECASE,
    ):
        return False
    return bool(_SUBSCRIPTION_RELATED_KEY_RE.search(key))


def is_obligation_key(key: str) -> bool:
    """Public predicate: does a user_facts key describe a recurring
    obligation that should live in the `obligations` table?
    """
    if not key:
        return False
    if _OBLIGATION_KEY_EXCLUDE.search(key):
        return False
    return bool(_OBLIGATION_KEY_INCLUDE.search(key))


def _fact_looks_like_subscription(fact: dict[str, Any]) -> bool:
    return is_subscription_key(str(fact.get("key") or ""))


def _fact_looks_like_obligation(fact: dict[str, Any]) -> bool:
    return is_obligation_key(str(fact.get("key") or ""))


def _matched_known_service(key: str) -> str | None:
    """Return the known-service token present in `key`, if any."""
    lower = (key or "").lower()
    for svc in _KNOWN_SUBSCRIPTION_SERVICES:
        if re.search(rf"(^|_){re.escape(svc)}($|_)", lower):
            return svc
    return None


# Canonical brand display names — `key_to_display_name` capitalises naively
# (e.g. "chatgpt" → "Chatgpt"), so we override common cases.
_BRAND_DISPLAY: dict[str, str] = {
    "netflix": "Netflix",
    "spotify": "Spotify",
    "apple_music": "Apple Music",
    "youtube_premium": "YouTube Premium",
    "youtube_music": "YouTube Music",
    "icloud": "iCloud",
    "google_drive": "Google Drive",
    "google_one": "Google One",
    "dropbox": "Dropbox",
    "amazon_prime": "Amazon Prime",
    "duolingo": "Duolingo",
    "chatgpt": "ChatGPT",
    "claude": "Claude",
    "midjourney": "Midjourney",
    "github_pro": "GitHub Pro",
    "github_copilot": "GitHub Copilot",
    "figma": "Figma",
    "notion": "Notion",
    "linear": "Linear",
    "vpn": "VPN",
    "gym_membership": "Gym Membership",
    "adobe": "Adobe",
    "setapp": "Setapp",
}


def canonical_subscription_name(key: str) -> str:
    """Collapse fact-key variants down to a single stable subscription name.

    Examples:
      has_spotify_family            → "Spotify"
      uses_spotify                  → "Spotify"
      spotify_family_subscription   → "Spotify"
      google_one                    → "Google One"
      chatgpt_plus                  → "ChatGPT"
      streaming_subscription        → "Streaming"  (generic fallback)

    Keys that don't contain a known service fall through to a cleaned-up
    display version of the key itself.
    """
    known = _matched_known_service(key)
    if known:
        return _BRAND_DISPLAY.get(known, key_to_display_name(known) or "Unnamed")
    cleaned = key or ""
    lower_prefixes = ("has_", "uses_", "owns_", "pays_")
    lc = cleaned.lower()
    for prefix in lower_prefixes:
        if lc.startswith(prefix):
            cleaned = cleaned[len(prefix):]
            break
    if cleaned.lower().endswith("_subscription"):
        cleaned = cleaned[: -len("_subscription")]
    return key_to_display_name(cleaned) or "Unnamed"


def _recurring_name_from_key(fact: dict[str, Any]) -> str:
    """Use the fact key (formatted) as the recurring item name.

    We deliberately ignore the value text — it often contains unrelated
    narrative that would produce noisy names like 'Работает над проектом X'.
    """
    key = str(fact.get("key") or "")
    cleaned = key
    for prefix in ("has_", "uses_", "owns_", "pays_"):
        if cleaned.lower().startswith(prefix):
            cleaned = cleaned[len(prefix) :]
            break
    return key_to_display_name(cleaned) or "Unnamed"


def _upsert_subscription_from_fact(db: Any, fact: dict[str, Any]) -> None:
    key = str(fact.get("key") or "")
    value = str(fact.get("value") or "")
    has_known_service = _matched_known_service(key) is not None
    # Generic "subscription"-suffixed keys still require an explicit monthly
    # cadence to avoid grabbing one-off mentions. Keys that name a specific
    # service (netflix, chatgpt, spotify, etc.) are inherently recurring.
    if not has_known_service and not _has_monthly_cadence(value):
        return
    amount = parse_amount_from_text(value)
    if amount is None or amount <= 0:
        return
    name = canonical_subscription_name(key)
    existing = fetch_one(
        db,
        "SELECT id, source, amount FROM subscriptions WHERE LOWER(name) = LOWER(?)",
        (name,),
    )
    if existing is not None:
        # Never overwrite a manually-entered row from chat extraction.
        if str(existing.get("source") or "").lower() == "manual":
            return
        execute(
            db,
            """
            UPDATE subscriptions
               SET amount = ?,
                   is_active = 1,
                   source = 'chat',
                   updated_at = datetime('now')
             WHERE id = ?
            """,
            (amount, int(existing["id"])),
        )
        return
    execute(
        db,
        """
        INSERT INTO subscriptions
            (name, amount, currency, category, is_active, source,
             created_at, updated_at)
        VALUES (?, ?, 'EUR', 'other', 1, 'chat',
                datetime('now'), datetime('now'))
        """,
        (name, amount),
    )


def _upsert_obligation_from_fact(db: Any, fact: dict[str, Any]) -> None:
    value = str(fact.get("value") or "")
    if not _has_monthly_cadence(value):
        # Loan facts usually describe principal/balance, not the monthly
        # payment — without an explicit monthly cadence the parsed € amount
        # would be misleading. Let the user enter loan details manually.
        return
    if _looks_like_inbound_money(value):
        # Value describes income (rental income, salary) rather than an
        # outbound monthly payment.
        return
    amount = parse_amount_from_text(value)
    if amount is None or amount <= 0:
        return
    name = _recurring_name_from_key(fact)
    existing = fetch_one(
        db,
        "SELECT id, source FROM obligations WHERE LOWER(name) = LOWER(?)",
        (name,),
    )
    if existing is not None:
        if str(existing.get("source") or "").lower() == "manual":
            return
        execute(
            db,
            """
            UPDATE obligations
               SET monthly_payment = ?,
                   is_active = 1,
                   source = 'chat',
                   updated_at = datetime('now')
             WHERE id = ?
            """,
            (amount, int(existing["id"])),
        )
        return
    execute(
        db,
        """
        INSERT INTO obligations
            (name, monthly_payment, category, is_active, source,
             created_at, updated_at)
        VALUES (?, ?, 'loan', 1, 'chat',
                datetime('now'), datetime('now'))
        """,
        (name, amount),
    )


def _maybe_persist_recurring(db: Any, fact: dict[str, Any]) -> None:
    """If a fact describes a subscription or loan, mirror it into the
    dedicated table so finance UI can show structured rows.

    Only triggers when the fact key matches a strict allow-list pattern
    and a positive € amount is parseable from the value. Work facts,
    project facts, credit-card usage strategies, account balances and
    interest-free periods are never mirrored.
    """
    try:
        if _fact_looks_like_subscription(fact):
            _upsert_subscription_from_fact(db, fact)
            return
        if _fact_looks_like_obligation(fact):
            _upsert_obligation_from_fact(db, fact)
    except Exception:
        logger.exception(
            "Failed to mirror fact to recurring table: %s", fact.get("key")
        )


async def extract_facts(
    user_messages: list[str], db: Any, api_key: str
) -> list[dict]:
    messages = [m.strip() for m in user_messages if (m or "").strip()]
    if not messages:
        return []

    try:
        raw_text = await call_claude(
            _build_prompt(messages), api_key=api_key, model=DEFAULT_MODEL
        )
        items = parse_json_array(raw_text)
    except Exception:
        logger.exception("Claude fact extraction failed")
        return []

    saved: list[dict] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        fact = _normalize_fact(item)
        if not fact:
            continue
        try:
            row = _upsert_fact(db, fact)
            if row is not None:
                saved.append(row)
                _maybe_persist_recurring(db, fact)
        except Exception:
            logger.exception("Failed to save fact: %s", fact.get("key"))

    return saved
