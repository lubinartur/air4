"""Time Layers API (daily summaries)."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.services import time_layer_service

router = APIRouter()


@router.post("/time/daily/{day}")
def post_daily_summary(day: date, db: Session = Depends(get_db)) -> dict:
    summary = time_layer_service.generate_daily_summary(db, day)
    return time_layer_service.daily_summary_to_dict(summary)


@router.get("/time/daily/{day}")
def get_daily_summary(day: date, db: Session = Depends(get_db)) -> dict:
    row = time_layer_service.get_daily_summary(db, day)
    if row is None:
        raise HTTPException(status_code=404, detail="Daily summary not found for this date.")
    return time_layer_service.daily_summary_to_dict(row)
