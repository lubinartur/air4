from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Query

from database import fetch_all, fetch_one, get_db
from schemas import PaginatedTransactionsOut, TransactionOut
from services.summary_loader import latest_upload_id

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
def list_transactions(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    category: Optional[str] = None,
    upload_id: Optional[int] = None,
) -> PaginatedTransactionsOut:
    with get_db() as conn:
        if upload_id is None:
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
