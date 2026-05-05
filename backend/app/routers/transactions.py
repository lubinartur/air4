from __future__ import annotations

from typing import Optional

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query

from app.database import execute, fetch_all, fetch_one, get_db
from app.models.transaction import PaginatedTransactionsOut, TransactionOut, UpdateCategoryIn
from app.routers.summary import _latest_upload_id


router = APIRouter()

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
async def list_transactions(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    category: Optional[str] = None,
    is_debit: Optional[bool] = None,
    exclude_internal: bool = True,
    upload_id: Optional[int] = None,
    db: aiosqlite.Connection = Depends(get_db),
) -> PaginatedTransactionsOut:
    if upload_id is None:
        upload_id = await _latest_upload_id(db)

    where = []
    params: list[object] = []
    if category is not None and str(category).strip() != "":
        where.append("category = ?")
        params.append(str(category).strip())
    if is_debit is not None:
        where.append("is_debit = ?")
        params.append(bool(is_debit))
    if exclude_internal:
        where.append("COALESCE(is_internal_transfer, 0) = 0")
    where.append(_EXCLUDE_SERVICE_ROWS)
    if upload_id is not None:
        where.append("upload_id = ?")
        params.append(int(upload_id))

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    total_row = await fetch_one(
        db,
        f"SELECT COUNT(*) as cnt FROM transactions {where_sql}",
        params,
    )
    total = int((total_row or {}).get("cnt") or 0)

    rows = await fetch_all(
        db,
        f"""
        SELECT *
        FROM transactions
        {where_sql}
        ORDER BY date DESC, id DESC
        LIMIT ? OFFSET ?
        """,
        [*params, int(limit), int(skip)],
    )

    items = [TransactionOut(**r) for r in rows]
    return PaginatedTransactionsOut(total=total, skip=skip, limit=limit, items=items)


@router.put("/transactions/{transaction_id}/category", response_model=TransactionOut)
async def update_category(
    transaction_id: int,
    body: UpdateCategoryIn,
    db: aiosqlite.Connection = Depends(get_db),
) -> TransactionOut:
    row = await fetch_one(db, "SELECT * FROM transactions WHERE id = ?", (transaction_id,))
    if row is None:
        raise HTTPException(status_code=404, detail="Transaction not found")

    await execute(
        db,
        "UPDATE transactions SET category = ?, category_confirmed = 1 WHERE id = ?",
        (body.category, transaction_id),
    )
    updated = await fetch_one(db, "SELECT * FROM transactions WHERE id = ?", (transaction_id,))
    if updated is None:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return TransactionOut(**updated)

