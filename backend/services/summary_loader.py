from __future__ import annotations

import json
import sqlite3
from datetime import date
from typing import Any

from database import fetch_all, fetch_one
from schemas import InternalTransferSummary, OtherIncomingSummary, SummaryOut
# NOTE: transfer detection (`mark_internal_transfers_in_db`,
# `sync_known_ibans_from_db`) used to run on every summary load. It now
# runs once at upload time (`routers/upload.py`); summary is read-only
# against the persisted `is_internal_transfer` flag.

_EMPTY = SummaryOut(
    period_start=None,
    period_end=None,
    total_spent=0.0,
    total_income=0.0,
    by_category={},
    internal_transfers=InternalTransferSummary(amount=0.0, count=0),
    other_incoming=OtherIncomingSummary(amount=0.0, count=0),
)

# Exclude non-spending rows from totals and category breakdown.
_EXTERNAL_ONLY = "COALESCE(is_internal_transfer, 0) = 0"

# "Neutral" categories — real money movement, but neither income nor expense.
# Debt repayments and inter-personal transfers shift cash around without
# representing consumption; counting them as spending inflates `total_spent`
# and distorts the «свободный капитал» figure.
#
# Note: `loan_payment` is intentionally NOT neutral. Mortgage / consumer-loan
# instalments are part of the user's monthly burn and must count toward
# `total_spent` so the "what I really live on" figure stays realistic. The
# obligation-balance bookkeeping for those payments lives in the transactions
# router (auto-decrement of `obligations.remaining_amount`).
#
# The `internal_transfer` member is the logical name for the
# `is_internal_transfer` boolean column (own-IBAN ↔ own-IBAN moves) and is
# already filtered via `_EXTERNAL_ONLY`. The two `category`-column values
# below are filtered explicitly through `_SPENDING_CATEGORY` so an external
# repayment / friend transfer is also excluded from `total_spent`.
NEUTRAL_CATEGORIES: frozenset[str] = frozenset(
    {"repayment", "internal_transfer", "transfers"}
)

# Categories representable as a string value in the `category` column. The
# `internal_transfer` neutral kind lives in its own boolean column and is
# intentionally excluded from this tuple.
_NEUTRAL_CATEGORY_NAMES: tuple[str, ...] = tuple(
    sorted(NEUTRAL_CATEGORIES - {"internal_transfer"})
)

# SQL fragment that keeps NULL categories (legacy uncategorized rows count as
# spending) but rejects the explicit neutral ones.
_SPENDING_CATEGORY = (
    "(category IS NULL OR category NOT IN ("
    + ",".join("?" * len(_NEUTRAL_CATEGORY_NAMES))
    + "))"
)

# Salary-cycle anchor: the 10th of each month is "payday".
# The current cycle always runs from a 10th through the 9th of the next month.
_CYCLE_ANCHOR_DAY = 10


def latest_upload_id(conn: sqlite3.Connection) -> int | None:
    row = fetch_one(
        conn,
        """
        SELECT id
        FROM uploads
        ORDER BY created_at DESC, id DESC
        LIMIT 1
        """,
    )
    return int(row["id"]) if row else None


def salary_cycle_period(today: date | None = None) -> tuple[str, str]:
    """Active salary-cycle window in ISO format.

    - If today's day >= 10  → window is [this_10th, next_9th]
    - If today's day <  10  → window is [prev_10th, this_9th]

    Returns (start_iso, end_iso) as YYYY-MM-DD strings.
    """
    today = today or date.today()
    if today.day >= _CYCLE_ANCHOR_DAY:
        start = today.replace(day=_CYCLE_ANCHOR_DAY)
    else:
        if today.month == 1:
            start = date(today.year - 1, 12, _CYCLE_ANCHOR_DAY)
        else:
            start = date(today.year, today.month - 1, _CYCLE_ANCHOR_DAY)

    if start.month == 12:
        end = date(start.year + 1, 1, _CYCLE_ANCHOR_DAY - 1)
    else:
        end = date(start.year, start.month + 1, _CYCLE_ANCHOR_DAY - 1)

    return start.isoformat(), end.isoformat()


def _load_income_keywords(conn: sqlite3.Connection) -> list[str]:
    """Flat list of lowercase substrings from all active income_sources.

    Each row stores `keywords` as a JSON array — we flatten across sources
    so any matching substring qualifies a row as real income.
    """
    keywords: list[str] = []
    try:
        rows = fetch_all(
            conn,
            "SELECT keywords FROM income_sources WHERE COALESCE(is_active, 1) = 1",
        )
    except sqlite3.OperationalError:
        # Table may not exist yet on a fresh DB before init_db has run.
        return keywords

    for row in rows:
        raw = row.get("keywords") if isinstance(row, dict) else None
        if not raw:
            continue
        try:
            parsed = json.loads(str(raw))
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(parsed, list):
            continue
        for item in parsed:
            kw = str(item or "").strip().lower()
            if kw and kw not in keywords:
                keywords.append(kw)
    return keywords


def _income_match_clause(keywords: list[str]) -> tuple[str, list[str]]:
    """Build a SQL fragment that matches a row against any income keyword.

    Returns a (clause, params) tuple, where clause is empty when no keywords
    are configured.
    """
    if not keywords:
        return "", []
    parts: list[str] = []
    params: list[str] = []
    for kw in keywords:
        like = f"%{kw}%"
        parts.append(
            "LOWER(COALESCE(description, '')) LIKE ? "
            "OR LOWER(COALESCE(raw_description, '')) LIKE ?"
        )
        params.extend([like, like])
    return "(" + " OR ".join(parts) + ")", params


def load_summary(
    conn: sqlite3.Connection,
    *,
    period_start: str | None = None,
    period_end: str | None = None,
) -> SummaryOut:
    """Build a finance summary for a date range.

    Default range is the active salary cycle (10th → 9th of next month).
    Callers can pass `period_start` / `period_end` (ISO strings) to override —
    used by timeline / history views.

    The range is applied to *all* transactions across all owner IBANs, so
    income and spending span both Swedbank accounts naturally.

    This function is read-only against the `is_internal_transfer` column;
    transfer detection happens at upload time, not on every summary fetch.
    """
    if latest_upload_id(conn) is None:
        return _EMPTY

    if period_start is None or period_end is None:
        period_start, period_end = salary_cycle_period()

    base_params: list[Any] = [period_start, period_end]
    period_where = """
      date >= ?
      AND date <= ?
    """

    # `total_spent` is the user's actual consumption — neutral movements
    # (debt repayment, transfers in/out) are excluded so the figure matches
    # the «настоящие расходы» framing in the UI.
    spent_row = fetch_one(
        conn,
        f"""
        SELECT COALESCE(SUM(ABS(amount)), 0) AS total
        FROM transactions
        WHERE is_debit = 1
          AND {period_where}
          AND {_EXTERNAL_ONLY}
          AND {_SPENDING_CATEGORY}
        """,
        [*base_params, *_NEUTRAL_CATEGORY_NAMES],
    )

    # Income = only rows matching a configured income_sources keyword.
    # Everything else incoming (transfers from friends, refunds, cashback)
    # rolls up into `other_incoming` and is excluded from free capital.
    income_keywords = _load_income_keywords(conn)
    income_clause, income_params = _income_match_clause(income_keywords)

    incoming_where = f"""
        is_debit = 0
        AND {period_where}
        AND {_EXTERNAL_ONLY}
    """

    if income_clause:
        income_row = fetch_one(
            conn,
            f"""
            SELECT
                COALESCE(SUM(ABS(amount)), 0) AS total_income,
                COUNT(*) AS count
            FROM transactions
            WHERE {incoming_where}
              AND {income_clause}
            """,
            [*base_params, *income_params],
        )
        other_incoming_row = fetch_one(
            conn,
            f"""
            SELECT
                COALESCE(SUM(ABS(amount)), 0) AS total,
                COUNT(*) AS count
            FROM transactions
            WHERE {incoming_where}
              AND NOT {income_clause}
            """,
            [*base_params, *income_params],
        )
    else:
        # No income sources configured → nothing qualifies as real income.
        # Everything incoming (non-internal) becomes other_incoming so the
        # user can see what's there and configure sources accordingly.
        income_row = {"total_income": 0.0, "count": 0}
        other_incoming_row = fetch_one(
            conn,
            f"""
            SELECT
                COALESCE(SUM(ABS(amount)), 0) AS total,
                COUNT(*) AS count
            FROM transactions
            WHERE {incoming_where}
            """,
            base_params,
        )

    internal_row = fetch_one(
        conn,
        f"""
        SELECT
            COALESCE(SUM(ABS(amount)), 0) AS total,
            COUNT(*) AS count
        FROM transactions
        WHERE is_debit = 1
          AND is_internal_transfer = 1
          AND {period_where}
        """,
        base_params,
    )
    category_rows = fetch_all(
        conn,
        f"""
        SELECT
            COALESCE(category, 'other') AS category,
            COALESCE(SUM(ABS(amount)), 0) AS total,
            COUNT(*) AS count
        FROM transactions
        WHERE is_debit = 1
          AND {period_where}
          AND {_EXTERNAL_ONLY}
        GROUP BY category
        ORDER BY total DESC
        """,
        base_params,
    )

    by_category: dict[str, dict[str, Any]] = {
        str(row["category"]): {
            "amount": round(float(row["total"] or 0.0), 2),
            "count": int(row["count"] or 0),
        }
        for row in category_rows
    }

    # Spending breakdown: hide transfers when only internal movements remain in period.
    transfers_external = fetch_one(
        conn,
        f"""
        SELECT COUNT(*) AS count
        FROM transactions
        WHERE is_debit = 1
          AND COALESCE(category, 'other') = 'transfers'
          AND {period_where}
          AND {_EXTERNAL_ONLY}
        """,
        base_params,
    )
    if int((transfers_external or {}).get("count") or 0) == 0:
        by_category.pop("transfers", None)

    internal = InternalTransferSummary(
        amount=round(float((internal_row or {}).get("total") or 0.0), 2),
        count=int((internal_row or {}).get("count") or 0),
    )
    other_incoming = OtherIncomingSummary(
        amount=round(float((other_incoming_row or {}).get("total") or 0.0), 2),
        count=int((other_incoming_row or {}).get("count") or 0),
    )

    return SummaryOut(
        period_start=period_start,
        period_end=period_end,
        total_spent=round(float((spent_row or {}).get("total") or 0.0), 2),
        total_income=round(float((income_row or {}).get("total_income") or 0.0), 2),
        by_category=by_category,
        internal_transfers=internal,
        other_incoming=other_incoming,
    )
