from __future__ import annotations

import json

from fastapi import APIRouter, Query

from database import fetch_all, get_db
from schemas import InsightOut
from services.summary_loader import latest_upload_id

router = APIRouter()


def _parse_insight_row(row: dict) -> InsightOut | None:
    raw = row.get("insight_text") or ""
    try:
        data = json.loads(raw)
        if isinstance(data, dict):
            return InsightOut(
                type=str(data.get("type") or row.get("insight_type") or "insight"),
                title=str(data.get("title") or "").strip() or "Insight",
                description=str(data.get("description") or "").strip(),
                amount_mentioned=data.get("amount_mentioned"),
            )
    except (json.JSONDecodeError, TypeError, ValueError):
        pass
    text = str(raw).strip()
    if not text:
        return None
    return InsightOut(
        type=str(row.get("insight_type") or "insight"),
        title="Insight",
        description=text,
        amount_mentioned=None,
    )


@router.get("/insights", response_model=list[InsightOut])
def get_insights(upload_id: int | None = Query(None)) -> list[InsightOut]:
    with get_db() as conn:
        if upload_id is None:
            upload_id = latest_upload_id(conn)
        if upload_id is None:
            return []

        rows = fetch_all(
            conn,
            """
            SELECT insight_text, insight_type
            FROM insights
            WHERE upload_id = ?
            ORDER BY id ASC
            LIMIT 3
            """,
            (int(upload_id),),
        )

    out: list[InsightOut] = []
    for row in rows:
        ins = _parse_insight_row(row)
        if ins is not None and ins.description:
            out.append(ins)
    return out
