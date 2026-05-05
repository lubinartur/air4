from __future__ import annotations

import asyncio
import json
import logging

import aiosqlite
from fastapi import APIRouter, Depends, Query

from app.database import execute, fetch_all, get_db
from app.models.transaction import InsightOut
from app.routers.summary import _latest_upload_id, get_summary
from app.services.analyzer import OllamaAnalyzer

logger = logging.getLogger(__name__)

# Match analyzer HTTP timeout; wait_for ensures the route cannot hang indefinitely.
_INSIGHTS_ROUTE_TIMEOUT_S = 300.0

router = APIRouter()


def _compact_for_insights(summary: dict) -> dict:
    by_cat = summary.get("by_category") or []
    top = []
    if isinstance(by_cat, list):
        for row in by_cat[:5]:
            if isinstance(row, dict):
                top.append(
                    {
                        "category": row.get("category"),
                        "amount": float(row.get("amount") or 0.0),
                    }
                )
    return {
        "total_spent_eur": float(summary.get("total_spent") or 0.0),
        "top_categories": top,
    }


@router.get("/insights", response_model=list[InsightOut])
async def get_insights(
    upload_id: int | None = Query(None),
    db: aiosqlite.Connection = Depends(get_db),
) -> list[InsightOut]:
    if upload_id is None:
        upload_id = await _latest_upload_id(db)

    if upload_id is None:
        return []

    cached = await fetch_all(
        db,
        "SELECT insight_text FROM insights WHERE upload_id = ? ORDER BY id ASC",
        (int(upload_id),),
    )
    if cached:
        await execute(db, "DELETE FROM insights WHERE upload_id = ?", (int(upload_id),))

    summary = (await get_summary(upload_id=upload_id, db=db)).model_dump()
    compact = _compact_for_insights(summary)

    analyzer = OllamaAnalyzer()
    insights: list[InsightOut] = []
    try:
        insights = await asyncio.wait_for(
            analyzer.generate_insights(compact),
            timeout=_INSIGHTS_ROUTE_TIMEOUT_S,
        )
    except asyncio.TimeoutError as e:
        logger.error(
            "Insights generation timed out after %ss for upload_id=%s: %r",
            _INSIGHTS_ROUTE_TIMEOUT_S,
            upload_id,
            e,
            exc_info=True,
        )
        return []
    except Exception as e:
        logger.error(
            "Insights generation failed for upload_id=%s: %r",
            upload_id,
            e,
            exc_info=True,
        )
        return []

    if not insights:
        logger.warning(
            "Insights empty after Ollama call for upload_id=%s (compact=%s)",
            upload_id,
            compact,
        )
        return []

    for ins in insights[:3]:
        await execute(
            db,
            "INSERT INTO insights (upload_id, insight_text, insight_type) VALUES (?, ?, ?)",
            (int(upload_id), json.dumps(ins.model_dump(), ensure_ascii=False), ins.type),
        )

    return insights[:3]
