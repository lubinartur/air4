from __future__ import annotations

import aiosqlite
from fastapi import APIRouter, Depends, Query

from app.database import fetch_all, fetch_one, get_db
from app.models.transaction import SummaryOut


router = APIRouter()

# Exclude balance/service rows (prefix match on description and raw_description).
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


async def _latest_upload_id(db: aiosqlite.Connection) -> int | None:
    """
    Latest "active" import: the upload_id whose transactions were written most recently.
    Using MAX(uploads.id) is wrong when newer upload rows exist with zero transactions (failed import).
    """
    row = await fetch_one(
        db,
        """
        SELECT upload_id AS id
        FROM transactions
        GROUP BY upload_id
        ORDER BY MAX(id) DESC
        LIMIT 1
        """,
    )
    return int(row["id"]) if row else None


@router.get("/summary", response_model=SummaryOut)
async def get_summary(
    upload_id: int | None = Query(None),
    db: aiosqlite.Connection = Depends(get_db),
) -> SummaryOut:
    if upload_id is None:
        upload_id = await _latest_upload_id(db)

    # SQLite stores booleans as 0/1; COALESCE handles any legacy NULLs.
    where = (
        "WHERE COALESCE(is_debit, 0) = 1 AND COALESCE(is_internal_transfer, 0) = 0 "
        f"AND {_EXCLUDE_SERVICE_ROWS}"
    )
    params: list[object] = []
    if upload_id is not None:
        where += " AND upload_id = ?"
        params.append(int(upload_id))

    total_row = await fetch_one(
        db,
        f"SELECT COALESCE(SUM(amount), 0) AS total FROM transactions {where}",
        params,
    )
    total_spent = float((total_row or {}).get("total") or 0.0)

    rows = await fetch_all(
        db,
        f"""
        SELECT category, COALESCE(SUM(amount), 0) AS amount
        FROM transactions
        {where}
        GROUP BY category
        ORDER BY amount DESC
        """,
        params,
    )

    by_category = []
    for r in rows:
        amount = float(r["amount"] or 0.0)
        pct = (amount / total_spent * 100.0) if total_spent > 0 else 0.0
        by_category.append(
            {
                "category": r["category"],
                "amount": round(amount, 2),
                "percentage": round(pct, 1),
            }
        )

    period_start: str | None = None
    period_end: str | None = None
    upload_created_at: str | None = None
    if upload_id is not None:
        uprow = await fetch_one(
            db,
            "SELECT period_start, period_end, created_at FROM uploads WHERE id = ?",
            (int(upload_id),),
        )
        if uprow is not None:
            period_start = uprow.get("period_start")
            period_end = uprow.get("period_end")
            raw_ca = uprow.get("created_at")
            upload_created_at = str(raw_ca) if raw_ca is not None else None

    return SummaryOut(
        upload_id=upload_id,
        total_spent=round(total_spent, 2),
        by_category=by_category,
        period_start=period_start,
        period_end=period_end,
        created_at=upload_created_at,
    )

