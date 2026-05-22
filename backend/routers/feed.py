"""GET /api/feed — unified cross-sphere activity feed."""

from __future__ import annotations

from fastapi import APIRouter, Query

from database import get_db
from schemas import FeedItem, FeedOut
from services.feed import build_feed

router = APIRouter()


@router.get("/feed", response_model=FeedOut)
def feed(limit: int = Query(30, ge=1, le=200)) -> FeedOut:
    with get_db() as conn:
        raw_items = build_feed(conn, limit=limit)
    items = [
        FeedItem(
            type=str(item.get("type") or "event"),
            title=str(item.get("title") or ""),
            subtitle=item.get("subtitle"),
            amount=item.get("amount"),
            currency=item.get("currency"),
            icon=item.get("icon"),
            created_at=str(item.get("created_at") or ""),
        )
        for item in raw_items
    ]
    return FeedOut(items=items)
