from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from app.database import fetch_all, fetch_one, get_db
from app.models.report import ReportOut
from app.routers.summary import _latest_upload_id, get_summary
from app.routers.transactions import _EXCLUDE_SERVICE_ROWS
from app.services.analyzer import OllamaAnalyzer

logger = logging.getLogger(__name__)

_REPORT_ROUTE_TIMEOUT_S = 300.0

_PROFILE_ID = 1

router = APIRouter()


def _event_in_period(row: dict[str, Any], start: str | None, end: str | None) -> bool:
    if not start or not end:
        return True
    d = row.get("date")
    if d is None:
        return True
    ds = str(d).strip()
    if not ds:
        return True
    return bool(start <= ds <= end)


@router.post("/report", response_model=ReportOut)
async def generate_report(
    db: aiosqlite.Connection = Depends(get_db),
) -> ReportOut:
    upload_id = await _latest_upload_id(db)
    if upload_id is None:
        raise HTTPException(
            status_code=400,
            detail="No transaction data available. Upload a statement first.",
        )

    summary = (await get_summary(upload_id=upload_id, db=db)).model_dump()
    period_start = summary.get("period_start")
    period_end = summary.get("period_end")
    total_spent = float(summary.get("total_spent") or 0.0)
    by_category = summary.get("by_category") or []

    rows = await fetch_all(
        db,
        f"""
        SELECT *
        FROM transactions
        WHERE upload_id = ?
          AND COALESCE(is_debit, 0) = 1
          AND COALESCE(is_internal_transfer, 0) = 0
          AND {_EXCLUDE_SERVICE_ROWS}
        ORDER BY amount DESC
        LIMIT 20
        """,
        (int(upload_id),),
    )
    top_tx = [dict(r) for r in rows]

    event_rows = await fetch_all(db, "SELECT * FROM events ORDER BY datetime(created_at) DESC, id DESC")
    events_filtered: list[dict[str, Any]] = []
    for r in event_rows:
        row = dict(r)
        if _event_in_period(row, period_start, period_end):
            events_filtered.append(row)

    fact_rows = await fetch_all(
        db,
        """
        SELECT id, key, value, source, created_at, updated_at
        FROM user_facts
        ORDER BY key ASC
        """,
    )
    facts_list = [dict(r) for r in fact_rows]

    profile_row = await fetch_one(db, "SELECT * FROM user_profile WHERE id = ?", (_PROFILE_ID,))
    profile_dict: dict[str, Any] = dict(profile_row) if profile_row else {}

    display_name = str(profile_dict.get("name") or "").strip() or "User"

    analyzer = OllamaAnalyzer()
    try:
        report_text = await asyncio.wait_for(
            analyzer.generate_monthly_report(
                name=display_name,
                period_start=str(period_start) if period_start else None,
                period_end=str(period_end) if period_end else None,
                total_spent=total_spent,
                by_category=by_category if isinstance(by_category, list) else [],
                top_transaction_rows=top_tx,
                events=events_filtered,
                facts=facts_list,
                profile=profile_dict,
            ),
            timeout=_REPORT_ROUTE_TIMEOUT_S,
        )
    except asyncio.TimeoutError:
        logger.error("Report generation timed out after %ss", _REPORT_ROUTE_TIMEOUT_S)
        raise HTTPException(
            status_code=504,
            detail="Report generation timed out. Try again or check Ollama logs.",
        ) from None

    return ReportOut(report=report_text)
