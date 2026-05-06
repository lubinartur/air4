from __future__ import annotations

from typing import Any

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query

from app.database import fetch_all, fetch_one, get_db
from app.models.timeline import CompareOut, TimelineOut, UploadPeriodSummaryOut
from app.routers.summary import _EXCLUDE_SERVICE_ROWS, get_summary

router = APIRouter()


async def _transaction_count_for_upload(
    db: aiosqlite.Connection, upload_id: int
) -> int:
    row = await fetch_one(
        db,
        f"""
        SELECT COUNT(*) AS cnt
        FROM transactions
        WHERE upload_id = ?
          AND COALESCE(is_debit, 0) = 1
          AND COALESCE(is_internal_transfer, 0) = 0
          AND {_EXCLUDE_SERVICE_ROWS}
        """,
        (int(upload_id),),
    )
    return int((row or {}).get("cnt") or 0)


async def _period_summary(db: aiosqlite.Connection, upload_id: int) -> UploadPeriodSummaryOut:
    s = (await get_summary(upload_id=upload_id, db=db)).model_dump()
    txn_count = await _transaction_count_for_upload(db, upload_id)
    return UploadPeriodSummaryOut(
        upload_id=int(upload_id),
        period_start=s.get("period_start"),
        period_end=s.get("period_end"),
        total_spent=float(s.get("total_spent") or 0.0),
        by_category=s.get("by_category") or [],
        transaction_count=txn_count,
    )


@router.get("/timeline", response_model=TimelineOut)
async def get_timeline(
    db: aiosqlite.Connection = Depends(get_db),
) -> TimelineOut:
    upload_rows = await fetch_all(
        db,
        """
        SELECT id, period_start, period_end
        FROM uploads
        ORDER BY period_end DESC, id DESC
        """,
    )
    upload_ids = [int(r["id"]) for r in upload_rows]
    if not upload_ids:
        return TimelineOut(uploads=[])

    totals_rows = await fetch_all(
        db,
        f"""
        SELECT upload_id, COALESCE(SUM(amount), 0) AS total_spent, COUNT(*) AS transaction_count
        FROM transactions
        WHERE COALESCE(is_debit, 0) = 1
          AND COALESCE(is_internal_transfer, 0) = 0
          AND {_EXCLUDE_SERVICE_ROWS}
          AND upload_id IN ({",".join(["?"] * len(upload_ids))})
        GROUP BY upload_id
        """,
        upload_ids,
    )
    totals_by_upload: dict[int, dict[str, Any]] = {}
    for r in totals_rows:
        uid = int(r["upload_id"])
        totals_by_upload[uid] = {
            "total_spent": float(r["total_spent"] or 0.0),
            "transaction_count": int(r["transaction_count"] or 0),
        }

    cat_rows = await fetch_all(
        db,
        f"""
        SELECT upload_id, category, COALESCE(SUM(amount), 0) AS amount
        FROM transactions
        WHERE COALESCE(is_debit, 0) = 1
          AND COALESCE(is_internal_transfer, 0) = 0
          AND {_EXCLUDE_SERVICE_ROWS}
          AND upload_id IN ({",".join(["?"] * len(upload_ids))})
        GROUP BY upload_id, category
        ORDER BY upload_id ASC, amount DESC
        """,
        upload_ids,
    )
    cats_by_upload: dict[int, list[dict[str, Any]]] = {}
    for r in cat_rows:
        uid = int(r["upload_id"])
        cats_by_upload.setdefault(uid, []).append(
            {"category": r["category"], "amount": float(r["amount"] or 0.0)}
        )

    out: list[UploadPeriodSummaryOut] = []
    for u in upload_rows:
        uid = int(u["id"])
        totals = totals_by_upload.get(uid, {"total_spent": 0.0, "transaction_count": 0})
        total_spent = float(totals.get("total_spent") or 0.0)
        by_cat_raw = cats_by_upload.get(uid, [])
        by_category = []
        for row in by_cat_raw:
            amt = float(row.get("amount") or 0.0)
            pct = (amt / total_spent * 100.0) if total_spent > 0 else 0.0
            by_category.append(
                {
                    "category": row.get("category"),
                    "amount": round(amt, 2),
                    "percentage": round(pct, 1),
                }
            )
        out.append(
            UploadPeriodSummaryOut(
                upload_id=uid,
                period_start=u.get("period_start"),
                period_end=u.get("period_end"),
                total_spent=round(total_spent, 2),
                by_category=by_category,
                transaction_count=int(totals.get("transaction_count") or 0),
            )
        )

    return TimelineOut(uploads=out)


@router.get("/compare", response_model=CompareOut)
async def compare_periods(
    period1: int = Query(..., description="upload_id for earlier period"),
    period2: int = Query(..., description="upload_id for later period"),
    db: aiosqlite.Connection = Depends(get_db),
) -> CompareOut:
    p1 = await _period_summary(db, int(period1))
    p2 = await _period_summary(db, int(period2))

    total_diff = round(p2.total_spent - p1.total_spent, 2)
    total_pct = (
        round((total_diff / p1.total_spent) * 100.0, 1) if p1.total_spent > 0 else 0.0
    )

    map1 = {str(r.get("category")): float(r.get("amount") or 0.0) for r in (p1.by_category or [])}
    map2 = {str(r.get("category")): float(r.get("amount") or 0.0) for r in (p2.by_category or [])}
    cats = sorted(set(map1.keys()) | set(map2.keys()))

    diff_rows = []
    for c in cats:
        a1 = float(map1.get(c) or 0.0)
        a2 = float(map2.get(c) or 0.0)
        d = round(a2 - a1, 2)
        pct = round((d / a1) * 100.0, 1) if a1 > 0 else (100.0 if a2 > 0 else 0.0)
        diff_rows.append(
            {
                "category": c,
                "period1_amount": round(a1, 2),
                "period2_amount": round(a2, 2),
                "diff": d,
                "diff_pct": pct,
            }
        )
    diff_rows.sort(key=lambda r: abs(float(r.get("diff") or 0.0)), reverse=True)

    return CompareOut(
        period1=p1,
        period2=p2,
        diff={
            "total": total_diff,
            "total_pct": total_pct,
            "by_category": diff_rows,
        },
    )

