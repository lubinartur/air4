"""Meaning memory API (hypotheses from weekly patterns, v1)."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.services import meaning_service

router = APIRouter()


@router.post("/meaning/week/{week_start}")
def post_meanings_for_week(week_start: date, db: Session = Depends(get_db)) -> dict:
    created = meaning_service.generate_meanings_for_week(db, week_start)
    return {
        "items": [meaning_service.meaning_to_dict(m) for m in created],
        "count": len(created),
    }


@router.get("/meanings")
def get_meanings(
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
) -> dict:
    rows = meaning_service.list_meanings(db, limit=limit)
    items = [meaning_service.meaning_to_dict(r) for r in rows]
    return {"items": items, "count": len(items)}


@router.post("/meaning/confirm/{meaning_id}")
def post_confirm_meaning(meaning_id: str, db: Session = Depends(get_db)) -> dict:
    row = meaning_service.confirm_meaning(db, meaning_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Meaning not found.")
    return meaning_service.meaning_to_dict(row)


@router.post("/meaning/reject/{meaning_id}")
def post_reject_meaning(meaning_id: str, db: Session = Depends(get_db)) -> dict:
    row = meaning_service.reject_meaning(db, meaning_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Meaning not found.")
    return meaning_service.meaning_to_dict(row)
