from __future__ import annotations

from fastapi import APIRouter

from database import fetch_all, get_db
from schemas import BodyMetricOut, WorkoutOut

router = APIRouter()


@router.get("/health/metrics", response_model=list[BodyMetricOut])
def list_body_metrics() -> list[BodyMetricOut]:
    with get_db() as conn:
        rows = fetch_all(
            conn,
            """
            SELECT id, date, weight, height, body_fat, notes, source, created_at
            FROM body_metrics
            ORDER BY date DESC, id DESC
            LIMIT 3
            """,
        )
    return [BodyMetricOut(**r) for r in rows]


@router.get("/health/workouts", response_model=list[WorkoutOut])
def list_workouts() -> list[WorkoutOut]:
    with get_db() as conn:
        rows = fetch_all(
            conn,
            """
            SELECT id, date, type, duration, exercises, energy_level, notes, source, created_at
            FROM workouts
            ORDER BY date DESC, id DESC
            LIMIT 20
            """,
        )
    return [WorkoutOut(**r) for r in rows]
