from __future__ import annotations

import json
import logging
import re
import sqlite3

from database import execute, fetch_all
from services.llm_client import chat, parse_json_array
from services.parser import TransactionIn

logger = logging.getLogger(__name__)

CATEGORIES: list[str] = [
    "food_groceries",
    "food_restaurants",
    "transport",
    "entertainment",
    "health",
    "subscriptions",
    "shopping",
    "transfers",
    "loan_payment",
    "utilities",
    "salary",
    "other",
]

_SYSTEM = (
    "You are a precise transaction categorizer for Estonian bank statements (Swedbank).\n"
    "Common Estonian merchants: Rimi, Maxima, Prisma = food_groceries; "
    "Bolt, Taxify, Uber = transport; Wolt, Bolt Food = food_restaurants; "
    "Telia, Elisa, Tele2 = subscriptions; Enefit = utilities.\n"
    "Category guidance:\n"
    "- loan_payment = payments toward loans, mortgages, credit — "
    "основной долг и проценты (principal and interest).\n"
    "- transfers = generic person-to-person bank transfers / Ülekanne that "
    "are NOT loan instalments.\n"
    "Estonian finance terms:\n"
    "- Laenu põhiosa = loan principal → loan_payment\n"
    "- Kogunenud intress / intress = loan interest → loan_payment\n"
    "- Hüpoteek / eluasemelaen = mortgage → loan_payment\n"
    "- Ülekanne / Ulekanne (no loan context) = bank transfer → transfers\n"
    "- Kindlustusmakse = insurance → health or utilities\n"
    "- Kommunaalkulud = utilities → utilities\n"
    "- Salary / palk / töötasu = salary\n"
    f"Choose exactly one category per transaction from: {', '.join(CATEGORIES)}\n\n"
    "Rules:\n"
    "- Return ONLY a JSON array of strings.\n"
    "- No markdown, no explanation.\n"
    "- Array length must equal number of transactions.\n"
)


def categorize(transactions: list[TransactionIn]) -> list[str]:
    if not transactions:
        return []

    results: list[str] = []
    for i in range(0, len(transactions), 20):
        batch = transactions[i : i + 20]
        results.extend(_categorize_batch(batch))
    return results


def _categorize_batch(batch: list[TransactionIn]) -> list[str]:
    items = [
        {
            "date": t.date.isoformat(),
            "description": t.description,
            "amount": t.amount,
            "is_debit": t.is_debit,
        }
        for t in batch
    ]
    user = "Categorize these transactions. Output JSON array only.\n\n" + json.dumps(
        items, ensure_ascii=False
    )
    try:
        content = chat(
            messages=[{"role": "user", "content": user}],
            system=_SYSTEM,
            max_tokens=2048,
        )
    except Exception:
        return ["other"] * len(batch)

    parsed = parse_json_array(content)
    out: list[str] = []
    for cat in parsed:
        key = str(cat).strip()
        out.append(key if key in CATEGORIES else "other")
    if len(out) != len(batch):
        return ["other"] * len(batch)
    return out


# ---------------------------------------------------------------------------
# Categorization memory (`category_rules` table)
#
# When a user manually corrects a transaction's category in the
# CategoryReview modal, the PUT /transactions/{id}/category handler
# upserts a `category_rules` row keyed by a normalized merchant pattern
# extracted from the description. On the next CSV upload, those rules
# overlay the LLM's guess so the same merchant is never re-categorized
# by hand twice. Confidence is reserved for future fuzzy / system-seeded
# rules; user confirmations seed at 1.0 and auto-confirm matched rows.
# ---------------------------------------------------------------------------

# Boilerplate tokens that appear in nearly every Estonian Swedbank
# description (transaction codes / payment instrument noise). Stripping
# them keeps merchant patterns focused on the actual brand name.
_STOP_TOKENS: frozenset[str] = frozenset({
    "pos",
    "atm",
    "card",
    "visa",
    "mc",
    "mastercard",
    "ülekanne",
    "ulekanne",
    "maksekorraldus",
    "makse",
    "ostud",
    "ost",
})

# Strip digits, punctuation, currency symbols — everything that is
# transaction-specific noise rather than merchant identity. Whitespace
# is preserved so we can tokenize the remaining alphabetic words.
_NON_ALPHA_RE = re.compile(r"[\d/\-,;:.()*#%€$£+]+")

# Minimum length for a single token to count as "meaningful". Filters
# out fragments like "a", "to", "de" that appear in addresses.
_MIN_TOKEN_LEN = 3
# Maximum number of leading meaningful tokens to keep in a pattern. Two
# tokens balances specificity (rejects "rimi" matching "rimini") with
# reusability (covers "Rimi Tartu Selver" and "Rimi Tartu Lounakeskus"
# under one rule).
_MAX_PATTERN_TOKENS = 2


def extract_merchant_pattern(description: str | None) -> str | None:
    """Reduce a raw transaction description to a stable merchant fragment.

    Returns ``None`` when the description is empty or normalizes down to
    pure boilerplate — in that case no rule is created and the LLM keeps
    full authority over future transactions with similar descriptions.

    Examples (Estonian Swedbank):
        "POS RIMI TARTU 5168xxxx"        → "rimi tartu"
        "BOLT.EU/RIDES TALLINN, EE"      → "bolt eu"
        "Ülekanne TÜÜRIRENT"             → "tüürirent"   # stop token dropped
        "Maksekorraldus 25.04.2026"      → None          # only boilerplate
    """
    if not description:
        return None
    cleaned = _NON_ALPHA_RE.sub(" ", description.lower())
    tokens = [
        w
        for w in cleaned.split()
        if len(w) >= _MIN_TOKEN_LEN and w not in _STOP_TOKENS
    ]
    if not tokens:
        return None
    return " ".join(tokens[:_MAX_PATTERN_TOKENS])


def _description_matches_rule(
    description_lower: str,
    pattern: str,
    match_type: str,
) -> bool:
    """Cheap in-memory match check shared by `apply_category_rules` and
    the rule-deduplication step in the PUT handler."""
    if not pattern:
        return False
    if match_type == "exact":
        return description_lower == pattern
    if match_type == "starts_with":
        return description_lower.startswith(pattern)
    # Default ('contains') — most permissive, fits Estonian descriptions
    # like "POS RIMI TARTU 5168" where the merchant is buried in the
    # middle of the string.
    return pattern in description_lower


def apply_category_rules(
    conn: sqlite3.Connection,
    transactions: list[TransactionIn],
    current_categories: list[str],
    *,
    auto_confirm_threshold: float = 0.8,
) -> list[tuple[str, bool]]:
    """Overlay `category_rules` on top of LLM-derived categories.

    Returns a parallel list of ``(category, confirmed)`` tuples — same
    length and order as ``transactions``. ``confirmed`` is ``True`` when
    a rule with confidence ≥ ``auto_confirm_threshold`` produced the
    category (so the row can land as ``category_confirmed = 1`` and
    skip future review prompts).

    Caller contract: rule hits **override** the LLM category. When no
    rule matches, the current LLM category passes through with
    ``confirmed=False``.

    Side effect: bumps `times_applied` + `updated_at` for every rule
    that fires, so the UI can rank rules later.
    """
    if not transactions:
        return []

    rules = fetch_all(
        conn,
        """
        SELECT id, pattern, category, match_type, confidence
          FROM category_rules
         ORDER BY length(pattern) DESC, id ASC
        """,
    )
    # Order by pattern length DESC so more-specific rules win over more
    # generic ones when both match a description (e.g. "rimi tartu"
    # before a hypothetical bare "rimi").

    if not rules:
        return [(c, False) for c in current_categories]

    out: list[tuple[str, bool]] = []
    hit_rule_ids: list[int] = []
    for txn, llm_category in zip(transactions, current_categories, strict=False):
        description = (txn.description or "").lower()
        matched: dict | None = None
        for rule in rules:
            if _description_matches_rule(
                description,
                str(rule["pattern"]).lower(),
                str(rule.get("match_type") or "contains"),
            ):
                matched = rule
                break

        if matched is None:
            out.append((llm_category, False))
            continue

        confidence = float(matched.get("confidence") or 0.0)
        out.append(
            (str(matched["category"]), confidence >= auto_confirm_threshold)
        )
        hit_rule_ids.append(int(matched["id"]))

    if hit_rule_ids:
        # Bump times_applied + updated_at in a single statement per rule.
        # Plain loop keeps the SQL trivially safe (no IN-list construction).
        for rule_id in hit_rule_ids:
            execute(
                conn,
                """
                UPDATE category_rules
                   SET times_applied = times_applied + 1,
                       updated_at    = datetime('now')
                 WHERE id = ?
                """,
                (rule_id,),
            )
        logger.info(
            "apply_category_rules: %d/%d transactions matched a rule",
            len(hit_rule_ids),
            len(transactions),
        )

    return out


def upsert_category_rule_from_confirmation(
    conn: sqlite3.Connection,
    *,
    description: str | None,
    category: str,
    source: str = "user",
) -> dict | None:
    """Persist (or update) a merchant→category rule learned from a
    user-confirmed correction.

    Designed to be called inside the same DB connection as the
    transaction UPDATE in `PUT /transactions/{id}/category`, so the
    rule is created in the same transaction the user just confirmed.

    Returns the resulting rule row (with `id`, `pattern`, `category`,
    `match_type`) or ``None`` when no usable pattern could be extracted
    from the description — in that case the correction is still saved
    on the transaction, but no rule is learned.
    """
    pattern = extract_merchant_pattern(description)
    if not pattern:
        logger.info(
            "upsert_category_rule: no stable merchant pattern for description %r; "
            "skipping rule creation",
            description,
        )
        return None

    existing = fetch_all(
        conn,
        "SELECT id, category FROM category_rules WHERE pattern = ? LIMIT 1",
        (pattern,),
    )
    if existing:
        rule_id = int(existing[0]["id"])
        previous_category = str(existing[0].get("category") or "")
        if previous_category == category:
            logger.info(
                "upsert_category_rule: pattern %r already maps to %r, no-op",
                pattern,
                category,
            )
        else:
            execute(
                conn,
                """
                UPDATE category_rules
                   SET category   = ?,
                       confidence = 1.0,
                       source     = ?,
                       updated_at = datetime('now')
                 WHERE id = ?
                """,
                (category, source, rule_id),
            )
            logger.info(
                "upsert_category_rule: pattern %r re-mapped %r → %r",
                pattern,
                previous_category,
                category,
            )
        return {
            "id": rule_id,
            "pattern": pattern,
            "category": category,
            "match_type": "contains",
        }

    execute(
        conn,
        """
        INSERT INTO category_rules
            (pattern, category, match_type, confidence, source)
        VALUES (?, ?, 'contains', 1.0, ?)
        """,
        (pattern, category, source),
    )
    new_row = fetch_all(
        conn,
        "SELECT id, pattern, category, match_type FROM category_rules WHERE pattern = ? LIMIT 1",
        (pattern,),
    )
    if not new_row:
        return None
    row = new_row[0]
    logger.info(
        "upsert_category_rule: created rule id=%s pattern=%r → %r",
        row["id"],
        pattern,
        category,
    )
    return {
        "id": int(row["id"]),
        "pattern": str(row["pattern"]),
        "category": str(row["category"]),
        "match_type": str(row.get("match_type") or "contains"),
    }
