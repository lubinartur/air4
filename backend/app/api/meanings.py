"""Meaning memory API (hypotheses from weekly patterns, v1)."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.services import hypothesis_service, meaning_service
from app.services.meaning_confirmation_service import evaluate_meaning_confirmation

router = APIRouter()


@router.post("/meaning/hypotheses/generate")
def post_generate_behavior_hypotheses(db: Session = Depends(get_db)) -> dict:
    created = hypothesis_service.generate_behavior_hypotheses(db)
    return {
        "items": [meaning_service.meaning_to_dict(m) for m in created],
        "count": len(created),
    }


@router.post("/meaning/evaluate")
def post_evaluate_meanings(db: Session = Depends(get_db)) -> dict:
    result = evaluate_meaning_confirmation(db)
    return {
        "confirmed": [meaning_service.meaning_to_dict(m) for m in result["confirmed"]],
        "rejected": [meaning_service.meaning_to_dict(m) for m in result["rejected"]],
        "checked": result["checked"],
    }


@router.post("/meaning/week/{week_start}")
def post_meanings_for_week(week_start: date, db: Session = Depends(get_db)) -> dict:
    created = meaning_service.generate_meanings_for_week(db, week_start)
    return {
        "items": [meaning_service.meaning_to_dict(m) for m in created],
        "count": len(created),
    }


@router.get("/meanings/{meaning_id}")
def get_meaning_by_id(meaning_id: str, db: Session = Depends(get_db)) -> dict:
    row = meaning_service.get_meaning(db, meaning_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Meaning not found.")
    return meaning_service.meaning_to_dict(row)


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
