"""Monthly time-layer API."""

from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.services import monthly_service

router = APIRouter()

_MONTH_RE = re.compile(r"^\d{4}-\d{2}$")


def _validate_month_key(month: str) -> str:
    if not _MONTH_RE.fullmatch(month):
        raise HTTPException(
            status_code=422,
            detail="Invalid month: use YYYY-MM (e.g. 2026-05).",
        )
    y = int(month[:4])
    m = int(month[5:7])
    if m < 1 or m > 12:
        raise HTTPException(status_code=422, detail="Invalid month: month must be 01-12.")
    return month


@router.post("/time/monthly/{month}")
def post_monthly_summary(month: str, db: Session = Depends(get_db)) -> dict:
    _validate_month_key(month)
    try:
        row = monthly_service.generate_monthly_summary(db, month)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    return monthly_service.monthly_summary_to_dict(row)


@router.get("/time/monthly/{month}")
def get_monthly_summary(month: str, db: Session = Depends(get_db)) -> dict:
    _validate_month_key(month)
    row = monthly_service.get_monthly_summary(db, month)
    if row is None:
        raise HTTPException(status_code=404, detail="Monthly summary not found for this month.")
    return monthly_service.monthly_summary_to_dict(row)
