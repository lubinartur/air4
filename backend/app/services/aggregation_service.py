"""Orchestrates time layers: daily → weekly → monthly for a single calendar day."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from sqlalchemy.orm import Session

from app.services.monthly_service import generate_monthly_summary, monthly_summary_to_dict
from app.services.time_layer_service import daily_summary_to_dict, generate_daily_summary
from app.services.weekly_service import generate_weekly_reflection, weekly_reflection_to_dict


def _week_start_monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _month_key(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def rebuild_day(db: Session, day: date) -> dict[str, Any]:
    """
    Rebuild all time layers that depend on ``day``: daily for that date, then weekly
    for the ISO week containing ``day``, then monthly for that calendar month.
    """
    daily = generate_daily_summary(db, day)
    week_start = _week_start_monday(day)
    weekly = generate_weekly_reflection(db, week_start)
    month = _month_key(day)
    monthly = generate_monthly_summary(db, month)

    return {
        "date": day.isoformat(),
        "daily_summary": daily_summary_to_dict(daily),
        "weekly_reflection": weekly_reflection_to_dict(weekly),
        "monthly_summary": monthly_summary_to_dict(monthly),
    }
