from __future__ import annotations

import logging
import re
from typing import Any

from database import execute, fetch_all, fetch_one
from services.finance_facts import (
    key_to_display_name,
    parse_all_amounts_from_text,
    parse_amount_from_text,
    parse_obligation_amounts,
)
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
    r"|(^|_)obligation(s)?($|_)"
    r"|(^|_)(installment|installments|rassrochka)($|_)"
    r"|рассроч"
    r"|^pays_rent"
    r"|^rent_payment(s)?$"
    r"|^rents_(partners|alisa|spouse|wife|husband|family)_"
    r"|^financial_obligation(s)?$"
    r"|^monthly_obligation(s)?$"
    r")",
    re.IGNORECASE,
)

# Installment-plan narratives in the fact *value* (not only the key).
_REMAINING_BALANCE = re.compile(
    r"(?:осталось|остаётся|остается|remaining|left\s+to\s+pay|balance\s+left)",
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
    # Aggregate / meta keys that describe behaviour, not a single service.
    # Without these the title-cased key leaks in as a fake service name
    # (e.g. `manages_subscriptions_and_loans` → "Manages Subscriptions And Loans").
    r"|^manages_|^tracks_|^handles_|^maintains_|^monitors_|^reviews_|^oversees_"
    r"|recurring_subscriptions|subscriptions_and_"
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

    Matches classic loans (`car_loan`, `mortgage`) and device/installment
    keys the LLM emits (`iphone_17_pro_obligation`, `alisa_iphone_loan`,
    `iphone_installment`, keys containing ``рассроч``).
    """
    if not key:
        return False
    if _OBLIGATION_KEY_EXCLUDE.search(key):
        return False
    return bool(_OBLIGATION_KEY_INCLUDE.search(key))


def _looks_like_installment_plan_value(value: str | None) -> bool:
    """Value describes a payment plan: monthly cadence + balance left."""
    if not value or not _has_monthly_cadence(value):
        return False
    if not _REMAINING_BALANCE.search(value):
        return False
    return parse_amount_from_text(value) is not None


def _fact_looks_like_subscription(fact: dict[str, Any]) -> bool:
    return is_subscription_key(str(fact.get("key") or ""))


def _fact_looks_like_obligation(fact: dict[str, Any]) -> bool:
    key = str(fact.get("key") or "")
    value = str(fact.get("value") or "")
    if is_obligation_key(key):
        return True
    if _looks_like_installment_plan_value(value):
        return True
    return False


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


# Subscription-name blacklist. These patterns catch system/meta descriptions
# that get mistaken for real service names when a fact key is title-cased
# (e.g. `manages_subscriptions_and_loans` → "Manages Subscriptions And Loans").
# Used by both live chat extraction (`_upsert_subscription_from_fact`) and the
# one-time migration (`subscription_migration.migrate_facts_to_subscriptions`).
#
# A name is rejected if any of these match:
#   1. The leading word is a meta-verb (manages/tracks/handles/uses/...)
#      followed by "subscription(s)", "loan(s)", "obligation(s)", "expense(s)",
#      etc. — these are aggregate descriptors, not service names.
#   2. The bare word "Subscription"/"Subscriptions"/"Recurring" stands as the
#      whole subject without naming any actual brand.
#   3. The name is longer than the cap below — real service names are short.
_SUBSCRIPTION_NAME_MAX_LEN = 40

_BLACKLIST_LEADING_VERB = re.compile(
    r"^\s*(manages?|tracks?|handles?|uses?|owns?|maintains?|monitors?|"
    r"reviews?|oversees?|controls?)\b",
    re.IGNORECASE,
)

_BLACKLIST_META_NOUN = re.compile(
    r"\b(subscription|subscriptions|loan|loans|obligation|obligations|"
    r"expense|expenses|payment|payments|service|services|tool|tools|plan|"
    r"plans|account|accounts)\b",
    re.IGNORECASE,
)

_BLACKLIST_BARE_META = re.compile(
    r"^\s*(recurring(\s+subscriptions?)?|subscription(s)?|other\s+"
    r"subscriptions?|multiple\s+subscriptions?|various\s+subscriptions?)\s*$",
    re.IGNORECASE,
)


def is_blacklisted_subscription_name(name: str) -> bool:
    """Reject system/meta descriptions that should never become subscriptions.

    Real services are short and named after a brand (Netflix, Spotify,
    ChatGPT, ...). Anything that reads like a description ("Manages
    Subscriptions And Loans", "Tracks Subscriptions And Obligations",
    "Recurring Subscriptions") is rejected.
    """
    if not name:
        return True

    cleaned = name.strip()
    if not cleaned or cleaned.lower() == "unnamed":
        return True

    if len(cleaned) > _SUBSCRIPTION_NAME_MAX_LEN:
        return True

    if _BLACKLIST_BARE_META.match(cleaned):
        return True

    # Names that start with a meta-verb (Manages/Tracks/Handles/...) AND
    # contain a meta-noun are descriptions, not service names.
    if _BLACKLIST_LEADING_VERB.search(cleaned) and _BLACKLIST_META_NOUN.search(
        cleaned
    ):
        return True

    # Catch system descriptions that don't start with a verb but read as
    # multi-word phrases joined with "and" (e.g. "Subscriptions And Loans",
    # "Loans And Obligations") — these are never single-service names.
    if re.search(r"\band\b", cleaned, re.IGNORECASE) and _BLACKLIST_META_NOUN.search(
        cleaned
    ):
        # An exception: real brands sometimes contain "and" (rare). Allow
        # short ones (≤ 25 chars) to pass; long ones are descriptions.
        if len(cleaned) > 25:
            return True

    return False


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
    """Use the fact key (formatted) as the recurring item name."""
    key = str(fact.get("key") or "")
    cleaned = key
    for prefix in ("has_", "uses_", "owns_", "pays_"):
        if cleaned.lower().startswith(prefix):
            cleaned = cleaned[len(prefix) :]
            break
    for suffix in (
        "_obligation",
        "_obligations",
        "_loan",
        "_loans",
        "_installment",
        "_installments",
        "_rassrochka",
    ):
        if cleaned.lower().endswith(suffix):
            cleaned = cleaned[: -len(suffix)]
            break
    return key_to_display_name(cleaned) or "Unnamed"


def _obligation_name_from_fact(fact: dict[str, Any]) -> str:
    """Prefer a human label from the value (e.g. 'iPhone (Алиса)')."""
    value = str(fact.get("value") or "").strip()
    if value:
        # "iPhone (Алиса) — €111/мес" or "iPhone (Алиса), осталось …"
        head = re.split(
            r"\s*[—–-]\s*|\s*,\s*(?:осталось|всего|€|EUR|евро)",
            value,
            maxsplit=1,
            flags=re.IGNORECASE,
        )[0].strip()
        head = re.sub(
            r"\s*(?:€|EUR|eur|евро)\s*[\d][\d\s.,]*\s*$",
            "",
            head,
            flags=re.IGNORECASE,
        ).strip()
        if 2 <= len(head) <= 80:
            return head
    return _recurring_name_from_key(fact)


def _recurring_descriptor(
    *,
    kind: str,
    row_id: int,
    name: str,
    action: str,
    field: str,
    new_value: float,
    old_value: float | None = None,
    currency: str = "EUR",
) -> dict[str, Any]:
    """Shape matches `subscription_updater` so chat can merge both sources
    into a single `recurring_updated` list for the Finance UI."""
    return {
        "type": kind,
        "id": row_id,
        "name": name,
        "action": action,
        "field": field,
        "old_value": old_value,
        "new_value": new_value,
        "currency": currency,
    }


def _upsert_subscription_from_fact(
    db: Any, fact: dict[str, Any]
) -> dict[str, Any] | None:
    key = str(fact.get("key") or "")
    value = str(fact.get("value") or "")
    has_known_service = _matched_known_service(key) is not None
    # Generic "subscription"-suffixed keys still require an explicit monthly
    # cadence to avoid grabbing one-off mentions. Keys that name a specific
    # service (netflix, chatgpt, spotify, etc.) are inherently recurring.
    if not has_known_service and not _has_monthly_cadence(value):
        return None
    amount = parse_amount_from_text(value)
    if amount is None or amount <= 0:
        return None
    name = canonical_subscription_name(key)
    # Reject system/meta descriptions ("Manages Subscriptions And Loans" etc.)
    # — they leak in when a key has no known brand and the title-cased key
    # is used as the fallback name.
    if is_blacklisted_subscription_name(name):
        return None
    existing = fetch_one(
        db,
        "SELECT id, source, amount FROM subscriptions WHERE LOWER(name) = LOWER(?)",
        (name,),
    )
    if existing is not None:
        # Never overwrite a manually-entered row from chat extraction.
        if str(existing.get("source") or "").lower() == "manual":
            return None
        old = existing.get("amount")
        if old is not None and float(old) == amount:
            return None
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
        return _recurring_descriptor(
            kind="subscription",
            row_id=int(existing["id"]),
            name=name,
            action="updated",
            field="amount",
            new_value=amount,
            old_value=float(old) if old is not None else None,
        )
    new_id = execute(
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
    return _recurring_descriptor(
        kind="subscription",
        row_id=new_id,
        name=name,
        action="created",
        field="amount",
        new_value=amount,
    )


def persist_obligation(
    db: Any,
    *,
    name: str,
    monthly_payment: float | None = None,
    total_amount: float | None = None,
    remaining_amount: float | None = None,
    category: str = "loan",
) -> dict[str, Any] | None:
    """Single write path for obligations from facts or chat confirmations."""
    clean_name = (name or "").strip()
    if not clean_name:
        return None
    # Need at least one monetary field to avoid empty finance rows.
    if not any(
        x is not None and x > 0
        for x in (monthly_payment, total_amount, remaining_amount)
    ):
        return None

    existing = fetch_one(
        db,
        """
        SELECT id, source, monthly_payment, total_amount, remaining_amount
        FROM obligations
        WHERE LOWER(name) = LOWER(?)
        """,
        (clean_name,),
    )
    if existing is not None:
        if str(existing.get("source") or "").lower() == "manual":
            logger.info(
                "obligation persist: skip manual row name=%r", clean_name
            )
            return None
        old_monthly = existing.get("monthly_payment")
        execute(
            db,
            """
            UPDATE obligations
               SET monthly_payment = COALESCE(?, monthly_payment),
                   total_amount = COALESCE(?, total_amount),
                   remaining_amount = COALESCE(?, remaining_amount),
                   category = ?,
                   is_active = 1,
                   source = 'chat',
                   updated_at = datetime('now')
             WHERE id = ?
            """,
            (
                monthly_payment,
                total_amount,
                remaining_amount,
                category,
                int(existing["id"]),
            ),
        )
        reported = monthly_payment or total_amount or remaining_amount or 0.0
        return _recurring_descriptor(
            kind="obligation",
            row_id=int(existing["id"]),
            name=clean_name,
            action="updated",
            field="monthly_payment",
            new_value=float(reported),
            old_value=float(old_monthly) if old_monthly is not None else None,
        )

    new_id = execute(
        db,
        """
        INSERT INTO obligations
            (name, total_amount, remaining_amount, monthly_payment,
             category, is_active, source, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, 'chat', datetime('now'), datetime('now'))
        """,
        (
            clean_name,
            total_amount,
            remaining_amount,
            monthly_payment,
            category,
        ),
    )
    reported = monthly_payment or total_amount or remaining_amount or 0.0
    return _recurring_descriptor(
        kind="obligation",
        row_id=new_id,
        name=clean_name,
        action="created",
        field="monthly_payment",
        new_value=float(reported),
    )


def _upsert_obligation_from_fact(
    db: Any, fact: dict[str, Any]
) -> dict[str, Any] | None:
    key = str(fact.get("key") or "")
    value = str(fact.get("value") or "")
    key_match = is_obligation_key(key)
    installment_value = _looks_like_installment_plan_value(value)
    has_monthly = _has_monthly_cadence(value)

    if _looks_like_inbound_money(value):
        logger.info(
            "obligation mirror skip (inbound money): key=%r value=%r",
            key,
            value[:120],
        )
        return None

    amounts = parse_obligation_amounts(value)
    monthly = amounts.get("monthly_payment")
    total = amounts.get("total_amount")
    remaining = amounts.get("remaining_amount")

    if monthly is None and has_monthly:
        monthly = parse_amount_from_text(value)

    if monthly is None and total is None and remaining is None:
        fallback = parse_all_amounts_from_text(value)
        if fallback:
            if key_match or installment_value:
                total = fallback[0]
            elif has_monthly:
                monthly = fallback[0]

    # Allow obligation-suffixed keys with a principal amount even when the
    # user never said "в месяц" (common for "iPhone €1335" facts).
    if not (has_monthly or installment_value or key_match):
        logger.info(
            "obligation mirror skip (no cadence/key): key=%r value=%r",
            key,
            value[:120],
        )
        return None

    if not any(
        x is not None and x > 0 for x in (monthly, total, remaining)
    ):
        logger.info(
            "obligation mirror skip (no amount): key=%r value=%r",
            key,
            value[:120],
        )
        return None

    name = _obligation_name_from_fact(fact)
    result = persist_obligation(
        db,
        name=name,
        monthly_payment=monthly,
        total_amount=total,
        remaining_amount=remaining,
    )
    if result:
        logger.info(
            "obligation mirror ok: key=%r name=%r monthly=%s total=%s remaining=%s",
            key,
            name,
            monthly,
            total,
            remaining,
        )
    return result


def _maybe_persist_recurring(db: Any, fact: dict[str, Any]) -> dict[str, Any] | None:
    """If a fact describes a subscription or loan, mirror it into the
    dedicated table so finance UI can show structured rows.

    Only triggers when the fact key matches a strict allow-list pattern
    and a positive € amount is parseable from the value. Work facts,
    project facts, credit-card usage strategies, account balances and
    interest-free periods are never mirrored.

    Returns a `recurring_updated`-shaped dict when a row was created or
    updated, else ``None``.
    """
    key = str(fact.get("key") or "")
    try:
        if _fact_looks_like_subscription(fact):
            logger.debug("fact recurring: subscription candidate key=%r", key)
            return _upsert_subscription_from_fact(db, fact)
        if _fact_looks_like_obligation(fact):
            logger.info(
                "fact recurring: obligation candidate key=%r value=%r",
                key,
                str(fact.get("value") or "")[:160],
            )
            return _upsert_obligation_from_fact(db, fact)
        logger.debug("fact recurring: not mirrored key=%r", key)
    except Exception:
        logger.exception(
            "Failed to mirror fact to recurring table: %s", fact.get("key")
        )
    return None


async def extract_facts(
    user_messages: list[str], db: Any, api_key: str
) -> tuple[list[dict], list[dict[str, Any]]]:
    messages = [m.strip() for m in user_messages if (m or "").strip()]
    if not messages:
        return [], []

    try:
        raw_text = await call_claude(
            _build_prompt(messages), api_key=api_key, model=DEFAULT_MODEL
        )
        items = parse_json_array(raw_text)
    except Exception:
        logger.exception("Claude fact extraction failed")
        return [], []

    saved: list[dict] = []
    recurring_updated: list[dict[str, Any]] = []
    logger.info(
        "fact_extractor: LLM returned %d raw item(s) from %d message(s)",
        len(items),
        len(messages),
    )
    for item in items:
        if not isinstance(item, dict):
            continue
        fact = _normalize_fact(item)
        if not fact:
            continue
        logger.info(
            "fact_extractor: extracted key=%r value=%r confidence=%s",
            fact.get("key"),
            str(fact.get("value") or "")[:160],
            fact.get("confidence"),
        )
        try:
            row = _upsert_fact(db, fact)
            if row is not None:
                saved.append(row)
                recurring = _maybe_persist_recurring(db, fact)
                if recurring is not None:
                    recurring_updated.append(recurring)
                    logger.info(
                        "fact_extractor: mirrored recurring %s id=%s name=%r",
                        recurring.get("type"),
                        recurring.get("id"),
                        recurring.get("name"),
                    )
        except Exception:
            logger.exception("Failed to save fact: %s", fact.get("key"))

    return saved, recurring_updated
