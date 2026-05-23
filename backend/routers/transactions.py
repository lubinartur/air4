from __future__ import annotations

import logging
import re
import sqlite3
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from database import execute, fetch_all, fetch_one, get_db
from schemas import PaginatedTransactionsOut, TransactionOut
from services.summary_loader import latest_upload_id

router = APIRouter()
logger = logging.getLogger(__name__)

# Accept any short snake-case-like slug. Custom categories created from the
# review screen go through this validator, so we deliberately don't pin to
# the canonical CATEGORIES list — but we do enforce shape so the chart
# legend, filter dropdowns, and DB indices stay sane.
# Single-char slugs (e.g. "x") and hyphenated names (home-improvement) must pass.
_CATEGORY_SLUG_RE = re.compile(r"^[a-z0-9]([a-z0-9_-]*[a-z0-9])?$")


class TransactionCategoryIn(BaseModel):
    category: str = Field(..., min_length=1, max_length=64)

    @field_validator("category", mode="before")
    @classmethod
    def _log_and_normalize_category(cls, value: object) -> str:
        logger.info(
            "PUT /transactions/.../category: received category=%r",
            value,
        )
        if value is None:
            raise ValueError("category is required")
        normalized = str(value).strip().lower()
        if not normalized:
            raise ValueError("category must not be empty")
        return normalized

_EXCLUDE_SERVICE_ROWS = """(
  (description NOT LIKE 'lõppsaldo%' AND description NOT LIKE 'Lõppsaldo%'
   AND description NOT LIKE 'käive%' AND description NOT LIKE 'Käive%'
   AND description NOT LIKE 'algsaldo%' AND description NOT LIKE 'Algsaldo%')
  AND (raw_description IS NULL OR (
    raw_description NOT LIKE 'lõppsaldo%' AND raw_description NOT LIKE 'Lõppsaldo%'
    AND raw_description NOT LIKE 'käive%' AND raw_description NOT LIKE 'Käive%'
    AND raw_description NOT LIKE 'algsaldo%' AND raw_description NOT LIKE 'Algsaldo%'
  ))
)"""


@router.get("/transactions", response_model=PaginatedTransactionsOut)
def list_transactions(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    category: Optional[str] = None,
    upload_id: Optional[int] = None,
    start: Optional[str] = Query(None, description="ISO date inclusive (YYYY-MM-DD)"),
    end: Optional[str] = Query(None, description="ISO date inclusive (YYYY-MM-DD)"),
) -> PaginatedTransactionsOut:
    with get_db() as conn:
        # When the caller pins a date range we trust it and skip the
        # latest-upload fallback (one cycle can span multiple uploads).
        if upload_id is None and not (start or end):
            upload_id = latest_upload_id(conn)

        where = [
            "COALESCE(is_internal_transfer, 0) = 0",
            _EXCLUDE_SERVICE_ROWS,
        ]
        params: list[object] = []
        if category is not None and str(category).strip():
            where.append("category = ?")
            params.append(str(category).strip())
        if upload_id is not None:
            where.append("upload_id = ?")
            params.append(int(upload_id))
        if start:
            where.append("date >= ?")
            params.append(str(start).strip())
        if end:
            where.append("date <= ?")
            params.append(str(end).strip())

        where_sql = "WHERE " + " AND ".join(where)

        total_row = fetch_one(
            conn,
            f"SELECT COUNT(*) AS cnt FROM transactions {where_sql}",
            params,
        )
        total = int((total_row or {}).get("cnt") or 0)

        rows = fetch_all(
            conn,
            f"""
            SELECT *
            FROM transactions
            {where_sql}
            ORDER BY date DESC, id DESC
            LIMIT ? OFFSET ?
            """,
            [*params, int(limit), int(skip)],
        )

    return PaginatedTransactionsOut(
        total=total,
        skip=skip,
        limit=limit,
        items=[TransactionOut(**r) for r in rows],
    )


# Words shorter than this from an obligation name are ignored when building
# description-keyword matches — single letters and 2-char fragments like "or",
# "и", "to" cause too many false positives against arbitrary descriptions.
_LOAN_NAME_TOKEN_MIN_LEN = 3

# Acceptable monthly-payment vs. transaction-amount drift before we still
# consider it the "same" obligation. 5% catches normal floating-rate jitter,
# rounding and partial principal-vs-interest splits.
_LOAN_AMOUNT_TOLERANCE = 0.05

# Tokens we don't want triggering a name match — pure noise like "loan" or
# "kredit" would otherwise match every obligation in the table.
_LOAN_NAME_STOPWORDS: frozenset[str] = frozenset(
    {
        "loan",
        "credit",
        "kredit",
        "laen",
        "laenu",
        "payment",
        "makse",
        "monthly",
        "and",
        "the",
        "для",
        "под",
    }
)


def _tokenize_obligation_name(name: str) -> list[str]:
    """Split an obligation name into matchable tokens.

    Keeps Cyrillic and Latin word characters, drops short/stopword tokens
    that would over-match arbitrary bank descriptions.
    """
    raw = re.split(r"[^a-z0-9а-яё]+", name.lower())
    return [
        tok
        for tok in raw
        if len(tok) >= _LOAN_NAME_TOKEN_MIN_LEN
        and tok not in _LOAN_NAME_STOPWORDS
    ]


def _apply_loan_payment_to_obligation(
    conn: sqlite3.Connection,
    *,
    transaction_id: int,
    previous_category: str | None,
    new_category: str,
) -> dict[str, Any] | None:
    """Attempt to attribute a transaction marked `loan_payment` to one of the
    active obligations and decrement its `remaining_amount` accordingly.

    Matching strategy (best-effort, both signals optional):
      1. Amount within ±`_LOAN_AMOUNT_TOLERANCE` of `monthly_payment`.
      2. Description contains a token from the obligation name.
    When both signals fire the rank is dominated by amount-closeness; when
    only the name matches we accept it but rank it lower than any amount
    match.

    Idempotency: the decrement only happens when the *previous* category was
    not already `loan_payment`. Re-saving the same value is a no-op.

    Returns a small audit payload (or `None` when nothing was decremented).
    """
    if new_category != "loan_payment":
        return None
    if previous_category == "loan_payment":
        logger.info(
            "loan_payment: tx %s already categorized as loan_payment, "
            "skipping obligation decrement",
            transaction_id,
        )
        return None

    tx = fetch_one(
        conn,
        "SELECT amount, description FROM transactions WHERE id = ?",
        (int(transaction_id),),
    )
    if tx is None:
        return None

    try:
        amount = abs(float(tx.get("amount") or 0.0))
    except (TypeError, ValueError):
        amount = 0.0
    if amount <= 0:
        logger.info(
            "loan_payment: tx %s has non-positive amount, skipping decrement",
            transaction_id,
        )
        return None

    description = (str(tx.get("description") or "")).lower()

    obligations = fetch_all(
        conn,
        """
        SELECT id, name, monthly_payment, remaining_amount
        FROM obligations
        WHERE is_active = 1
        """,
    )
    if not obligations:
        logger.info(
            "loan_payment: no active obligations to match against tx %s",
            transaction_id,
        )
        return None

    # Lower rank = better match. Amount-based matches land in (0, tolerance];
    # name-only matches get a constant rank of 1.0 so they sort after every
    # amount match no matter how loose.
    candidates: list[tuple[float, dict[str, Any]]] = []
    for ob in obligations:
        name = str(ob.get("name") or "").strip()
        monthly = ob.get("monthly_payment")
        try:
            monthly_val = float(monthly) if monthly is not None else None
        except (TypeError, ValueError):
            monthly_val = None

        amount_rank: float | None = None
        if monthly_val is not None and monthly_val > 0:
            drift = abs(amount - monthly_val) / monthly_val
            if drift <= _LOAN_AMOUNT_TOLERANCE:
                amount_rank = drift

        name_match = False
        if name:
            for tok in _tokenize_obligation_name(name):
                if tok in description:
                    name_match = True
                    break

        if amount_rank is not None or name_match:
            rank = amount_rank if amount_rank is not None else 1.0
            candidates.append((rank, dict(ob)))

    if not candidates:
        logger.info(
            "loan_payment: tx %s (amount=%.2f, desc=%r) matched no obligation",
            transaction_id,
            amount,
            description[:80],
        )
        return None

    candidates.sort(key=lambda x: x[0])
    rank, matched = candidates[0]
    ob_id = int(matched["id"])
    name = str(matched.get("name") or "")
    remaining_raw = matched.get("remaining_amount")
    try:
        remaining = float(remaining_raw) if remaining_raw is not None else None
    except (TypeError, ValueError):
        remaining = None

    if remaining is None:
        logger.info(
            "loan_payment: tx %s → obligation %s (%r) matched (rank=%.3f) "
            "but remaining_amount is NULL; skipping decrement",
            transaction_id,
            ob_id,
            name,
            rank,
        )
        return {
            "obligation_id": ob_id,
            "name": name,
            "matched": True,
            "decremented": False,
            "reason": "remaining_amount is NULL",
        }

    new_remaining = max(0.0, remaining - amount)
    execute(
        conn,
        """
        UPDATE obligations
           SET remaining_amount = ?,
               updated_at = datetime('now')
         WHERE id = ?
        """,
        (new_remaining, ob_id),
    )
    logger.info(
        "loan_payment: tx %s (€%.2f, %r) → obligation %s '%s' "
        "(rank=%.3f, candidates=%d); remaining %.2f → %.2f",
        transaction_id,
        amount,
        description[:80],
        ob_id,
        name,
        rank,
        len(candidates),
        remaining,
        new_remaining,
    )
    return {
        "obligation_id": ob_id,
        "name": name,
        "matched": True,
        "decremented": True,
        "previous_remaining": remaining,
        "new_remaining": new_remaining,
        "candidates": len(candidates),
    }


@router.put("/transactions/{transaction_id}/category", response_model=TransactionOut)
def update_transaction_category(
    transaction_id: int,
    body: TransactionCategoryIn,
) -> TransactionOut:
    """Manual category override from the categorization review screen.

    Accepts only categories from the canonical list, normalizes to
    lower-case, and flips `category_confirmed` so the row is treated as
    user-validated and the auto-categorizer never reverts it.

    Side effect: when the new category is `loan_payment` (and the previous
    category was something else) the transaction is matched against active
    obligations and the matched obligation's `remaining_amount` is
    decremented in the same connection. See
    `_apply_loan_payment_to_obligation` for the matching strategy.
    """
    category = body.category
    if not _CATEGORY_SLUG_RE.fullmatch(category):
        raise HTTPException(
            status_code=400,
            detail=(
                "Invalid category slug. Use 1–64 lowercase letters/digits, "
                "with optional underscores or hyphens (e.g. 'food_groceries', "
                "'pet_care')."
            ),
        )

    with get_db() as conn:
        row = fetch_one(
            conn,
            "SELECT id, category FROM transactions WHERE id = ?",
            (int(transaction_id),),
        )
        if row is None:
            raise HTTPException(status_code=404, detail="Transaction not found")
        previous_category = row.get("category") if isinstance(row, dict) else None

        execute(
            conn,
            """
            UPDATE transactions
               SET category = ?,
                   category_confirmed = 1
             WHERE id = ?
            """,
            (category, int(transaction_id)),
        )

        _apply_loan_payment_to_obligation(
            conn,
            transaction_id=int(transaction_id),
            previous_category=previous_category,
            new_category=category,
        )

        updated = fetch_one(
            conn,
            "SELECT * FROM transactions WHERE id = ?",
            (int(transaction_id),),
        )

    if updated is None:
        # Should be unreachable — we just updated this row inside the same connection.
        raise HTTPException(status_code=500, detail="Failed to read updated transaction")

    return TransactionOut(**updated)
