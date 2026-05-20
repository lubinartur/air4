from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter

from database import fetch_all, get_db
from schemas import BodyMetricOut, WorkoutExerciseOut, WorkoutOut, WorkoutSetOut

router = APIRouter()


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _to_int(value: Any, fallback: int | None = None) -> int | None:
    if value is None:
        return fallback
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def _parse_exercises(raw: str | None) -> list[WorkoutExerciseOut]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return []
    if not isinstance(data, list):
        return []

    out: list[WorkoutExerciseOut] = []
    for ex in data:
        if not isinstance(ex, dict):
            continue
        name = str(ex.get("exerciseName") or ex.get("name") or "").strip()
        if not name:
            continue
        muscle_raw = str(ex.get("muscleGroup") or "").strip()
        muscle = muscle_raw or None

        sets_in = ex.get("sets")
        sets_out: list[WorkoutSetOut] = []
        if isinstance(sets_in, list):
            for idx, item in enumerate(sets_in, start=1):
                if not isinstance(item, dict):
                    continue
                set_number = _to_int(item.get("setNumber"), idx) or idx
                weight = _to_float(item.get("weight"))
                reps = _to_int(item.get("reps"))
                sets_out.append(
                    WorkoutSetOut(setNumber=set_number, weight=weight, reps=reps)
                )

        out.append(
            WorkoutExerciseOut(
                exerciseName=name, muscleGroup=muscle, sets=sets_out
            )
        )
    return out


def _total_volume(exercises: list[WorkoutExerciseOut]) -> float | None:
    total = 0.0
    found = False
    for ex in exercises:
        for s in ex.sets:
            if s.weight is None or s.reps is None:
                continue
            total += float(s.weight) * float(s.reps)
            found = True
    return round(total, 2) if found else None


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

    result: list[WorkoutOut] = []
    for row in rows:
        exercises = _parse_exercises(row.get("exercises") if isinstance(row.get("exercises"), str) else None)
        result.append(
            WorkoutOut(
                id=int(row["id"]),
                date=str(row["date"]),
                type=row.get("type"),
                duration=row.get("duration"),
                exercises=exercises,
                energy_level=row.get("energy_level"),
                notes=row.get("notes"),
                source=row.get("source") or "chat",
                created_at=row.get("created_at"),
                total_volume=_total_volume(exercises),
            )
        )
    return result
