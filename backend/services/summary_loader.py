from __future__ import annotations

import sqlite3
from typing import Any

from database import fetch_all, fetch_one
from schemas import InternalTransferSummary, SummaryOut
from services.parser import mark_internal_transfers_in_db, sync_known_ibans_from_db

_EMPTY = SummaryOut(
    period_start=None,
    period_end=None,
    total_spent=0.0,
    total_income=0.0,
    by_category={},
    internal_transfers=InternalTransferSummary(amount=0.0, count=0),
)

# Exclude non-spending rows from totals and category breakdown.
_EXTERNAL_ONLY = "COALESCE(is_internal_transfer, 0) = 0"


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


def _latest_upload_period(conn: sqlite3.Connection) -> tuple[str, str] | None:
    """Period from the most recently uploaded statement."""
    row = fetch_one(
        conn,
        """
        SELECT period_start, period_end
        FROM uploads
        ORDER BY created_at DESC, id DESC
        LIMIT 1
        """,
    )
    if not row:
        return None
    start, end = row.get("period_start"), row.get("period_end")
    if start and end:
        return str(start), str(end)
    return None


def _period_bounds_from_transactions(
    conn: sqlite3.Connection, upload_id: int
) -> tuple[str, str] | None:
    row = fetch_one(
        conn,
        """
        SELECT MIN(date) AS period_start, MAX(date) AS period_end
        FROM transactions
        WHERE upload_id = ?
        """,
        (upload_id,),
    )
    if not row or row.get("period_start") is None:
        return None
    return str(row["period_start"]), str(row["period_end"])


def _refresh_internal_flags(
    conn: sqlite3.Connection, period_start: str, period_end: str
) -> None:
    """Backfill is_internal_transfer for rows imported before parser rules existed."""
    conn.execute(
        f"""
        UPDATE transactions
        SET is_internal_transfer = 1
        WHERE date >= ? AND date <= ?
          AND {_EXTERNAL_ONLY}
          AND (
            LOWER(COALESCE(raw_description, '')) LIKE '%transfer between own accounts%'
            OR LOWER(COALESCE(description, '')) LIKE '%transfer between own accounts%'
            OR LOWER(COALESCE(raw_description, '')) LIKE '%credit repayment%'
            OR LOWER(COALESCE(description, '')) LIKE '%credit repayment%'
          )
        """,
        (period_start, period_end),
    )
    conn.commit()


def load_summary(conn: sqlite3.Connection) -> SummaryOut:
    period = _latest_upload_period(conn)
    upload_id = latest_upload_id(conn)

    if upload_id is None:
        return _EMPTY

    if period is None:
        period = _period_bounds_from_transactions(conn, upload_id)

    if period is None:
        return _EMPTY

    period_start, period_end = period
    sync_known_ibans_from_db(conn)
    mark_internal_transfers_in_db(conn)
    _refresh_internal_flags(conn, period_start, period_end)

    base_params: list[Any] = [period_start, period_end]
    period_where = """
      date >= ?
      AND date <= ?
    """

    spent_row = fetch_one(
        conn,
        f"""
        SELECT COALESCE(SUM(ABS(amount)), 0) AS total
        FROM transactions
        WHERE is_debit = 1
          AND {period_where}
          AND {_EXTERNAL_ONLY}
        """,
        base_params,
    )
    income_row = fetch_one(
        conn,
        f"""
        SELECT COALESCE(SUM(ABS(amount)), 0) AS total_income
        FROM transactions
        WHERE is_debit = 0
          AND {period_where}
          AND {_EXTERNAL_ONLY}
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

    return SummaryOut(
        period_start=period_start,
        period_end=period_end,
        total_spent=round(float((spent_row or {}).get("total") or 0.0), 2),
        total_income=round(float((income_row or {}).get("total_income") or 0.0), 2),
        by_category=by_category,
        internal_transfers=internal,
    )
