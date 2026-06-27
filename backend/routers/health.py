from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from typing import Annotated

from fastapi import APIRouter, File, HTTPException, UploadFile

from database import fetch_all, fetch_one, get_db
from import_training_log import import_to_db, parse_training_log
from schemas import (
    BodyMetricIn,
    BodyMetricOut,
    HealthCheckupGroupOut,
    HealthCheckupsListOut,
    HealthMarkerHistoryOut,
    HealthMarkerHistoryPoint,
    HealthMarkerOut,
    TrainingLogImportOut,
    WorkoutExerciseOut,
    WorkoutIn,
    WorkoutOut,
    WorkoutSetOut,
)

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


def _today_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _normalize_date(raw: str | None) -> str:
    """Accept YYYY-MM-DD; fall back to today (UTC) when blank."""
    candidate = (raw or "").strip()
    if not candidate:
        return _today_iso()
    try:
        datetime.strptime(candidate, "%Y-%m-%d")
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail="date must be YYYY-MM-DD",
        ) from exc
    return candidate


def _serialize_exercises(exercises: list[WorkoutExerciseOut]) -> str:
    payload: list[dict[str, Any]] = []
    for ex in exercises:
        payload.append(
            {
                "exerciseName": ex.exerciseName,
                "muscleGroup": ex.muscleGroup,
                "sets": [
                    {"setNumber": s.setNumber, "weight": s.weight, "reps": s.reps}
                    for s in ex.sets
                ],
            }
        )
    return json.dumps(payload, ensure_ascii=False)


def _workout_to_out(row: dict[str, Any]) -> WorkoutOut:
    raw_exercises = row.get("exercises") if isinstance(row.get("exercises"), str) else None
    exercises = _parse_exercises(raw_exercises)
    return WorkoutOut(
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


@router.get("/health/metrics", response_model=list[BodyMetricOut])
def list_body_metrics() -> list[BodyMetricOut]:
    with get_db() as conn:
        rows = fetch_all(
            conn,
            """
            SELECT id, date, weight, height, body_fat, notes, source, created_at
            FROM body_metrics
            ORDER BY date DESC, id DESC
            LIMIT 30
            """,
        )
    return [BodyMetricOut(**r) for r in rows]


@router.post("/health/metrics", response_model=BodyMetricOut)
def upsert_body_metric(payload: BodyMetricIn) -> BodyMetricOut:
    if (
        payload.weight is None
        and payload.height is None
        and payload.body_fat is None
        and not (payload.notes and payload.notes.strip())
    ):
        raise HTTPException(
            status_code=400,
            detail="at least one of weight, height, body_fat, or notes is required",
        )

    if payload.weight is not None and not (20 <= payload.weight <= 400):
        raise HTTPException(status_code=400, detail="weight must be between 20 and 400 kg")
    if payload.height is not None and not (50 <= payload.height <= 260):
        raise HTTPException(status_code=400, detail="height must be between 50 and 260 cm")
    if payload.body_fat is not None and not (1 <= payload.body_fat <= 70):
        raise HTTPException(status_code=400, detail="body_fat must be between 1 and 70 percent")

    date = _normalize_date(payload.date)
    notes = payload.notes.strip() if payload.notes else None

    with get_db() as conn:
        existing = fetch_one(
            conn,
            """
            SELECT id, weight, height, body_fat, notes
            FROM body_metrics
            WHERE date = ?
            ORDER BY id DESC
            LIMIT 1
            """,
            (date,),
        )

        if existing is None:
            cur = conn.execute(
                """
                INSERT INTO body_metrics (date, weight, height, body_fat, notes, source, created_at)
                VALUES (?, ?, ?, ?, ?, 'manual', datetime('now'))
                """,
                (date, payload.weight, payload.height, payload.body_fat, notes),
            )
            metric_id = int(cur.lastrowid or 0)
        else:
            metric_id = int(existing["id"])
            merged_weight = payload.weight if payload.weight is not None else existing.get("weight")
            merged_height = payload.height if payload.height is not None else existing.get("height")
            merged_body_fat = (
                payload.body_fat if payload.body_fat is not None else existing.get("body_fat")
            )
            merged_notes = notes if notes is not None else existing.get("notes")
            conn.execute(
                """
                UPDATE body_metrics
                SET weight = ?, height = ?, body_fat = ?, notes = ?, source = 'manual'
                WHERE id = ?
                """,
                (merged_weight, merged_height, merged_body_fat, merged_notes, metric_id),
            )

        conn.commit()
        saved = fetch_one(
            conn,
            """
            SELECT id, date, weight, height, body_fat, notes, source, created_at
            FROM body_metrics
            WHERE id = ?
            """,
            (metric_id,),
        )

    if saved is None:
        raise HTTPException(status_code=500, detail="failed to persist body metric")
    return BodyMetricOut(**saved)


@router.get("/health/workouts", response_model=list[WorkoutOut])
def list_workouts() -> list[WorkoutOut]:
    with get_db() as conn:
        rows = fetch_all(
            conn,
            """
            SELECT id, date, type, duration, exercises, energy_level, notes, source, created_at
            FROM workouts
            ORDER BY date DESC, id DESC
            LIMIT 50
            """,
        )

    return [_workout_to_out(row) for row in rows]


@router.post("/health/workouts", response_model=WorkoutOut)
def create_workout(payload: WorkoutIn) -> WorkoutOut:
    if payload.duration is not None and payload.duration <= 0:
        raise HTTPException(status_code=400, detail="duration must be positive")
    if payload.energy_level is not None and not (1 <= payload.energy_level <= 10):
        raise HTTPException(
            status_code=400, detail="energy_level must be between 1 and 10"
        )

    date = _normalize_date(payload.date)
    workout_type = (payload.type or "").strip().lower() or None
    notes = (payload.notes or "").strip() or None
    exercises_json = _serialize_exercises(payload.exercises)

    with get_db() as conn:
        cur = conn.execute(
            """
            INSERT INTO workouts
                (date, type, duration, exercises, energy_level, notes, source, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'manual', datetime('now'))
            """,
            (
                date,
                workout_type,
                payload.duration,
                exercises_json,
                payload.energy_level,
                notes,
            ),
        )
        conn.commit()
        workout_id = int(cur.lastrowid or 0)
        saved = fetch_one(
            conn,
            """
            SELECT id, date, type, duration, exercises, energy_level, notes, source, created_at
            FROM workouts
            WHERE id = ?
            """,
            (workout_id,),
        )

    if saved is None:
        raise HTTPException(status_code=500, detail="failed to persist workout")
    return _workout_to_out(saved)


@router.post("/health/import-training-log", response_model=TrainingLogImportOut)
async def import_training_log_endpoint(
    file: Annotated[UploadFile, File()],
) -> TrainingLogImportOut:
    filename = (file.filename or "").lower()
    if not filename.endswith((".md", ".txt")):
        raise HTTPException(
            status_code=400,
            detail="Only .md or .txt training log files are supported",
        )

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    try:
        content = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(
            status_code=400,
            detail="Training log must be UTF-8 text",
        ) from exc

    workouts = parse_training_log(content)
    with get_db() as conn:
        result = import_to_db(workouts, conn)
        conn.commit()

    return TrainingLogImportOut(
        imported=result["imported"],
        skipped=result["skipped"],
        workouts=[_workout_to_out(row) for row in result["workouts"]],
    )


def _normalize_status(
    value: float,
    ref_min: float | None,
    ref_max: float | None,
    explicit: str | None,
) -> str:
    if explicit:
        return explicit.upper()
    if ref_max is not None and value > ref_max:
        return "HIGH"
    if ref_min is not None and value < ref_min:
        return "LOW"
    return "NORMAL"


@router.get(
    "/health/markers/{marker_name}/history",
    response_model=HealthMarkerHistoryOut,
)
def marker_history(marker_name: str) -> HealthMarkerHistoryOut:
    """Return all historical values for a single biomarker, oldest first.

    Names are matched case-insensitively against
    `LOWER(TRIM(marker_name))` so a click on "Hemoglobin" in the 2026
    checkup still picks up "hemoglobin" / "HEMOGLOBIN" rows recorded
    in earlier reports. The canonical `marker_name` echoed back is
    the most recent variant, which is what the UI is already showing
    in the row the user clicked.
    """
    needle = (marker_name or "").strip()
    if not needle:
        raise HTTPException(status_code=400, detail="marker_name is required")

    with get_db() as conn:
        rows = fetch_all(
            conn,
            """
            SELECT date, marker_name, value, unit,
                   reference_min, reference_max, status
            FROM health_checkups
            WHERE LOWER(TRIM(marker_name)) = LOWER(TRIM(?))
            ORDER BY date ASC, id ASC
            """,
            (needle,),
        )

    if not rows:
        # 404 lets the FE distinguish "no history for this marker" from
        # a transport failure and fall back to a friendly empty-state
        # in the chart panel.
        raise HTTPException(
            status_code=404,
            detail=f"no history for marker '{marker_name}'",
        )

    points: list[HealthMarkerHistoryPoint] = []
    for row in rows:
        value = _to_float(row.get("value")) or 0.0
        ref_min = _to_float(row.get("reference_min"))
        ref_max = _to_float(row.get("reference_max"))
        points.append(
            HealthMarkerHistoryPoint(
                date=str(row["date"]),
                value=value,
                unit=row.get("unit"),
                status=_normalize_status(value, ref_min, ref_max, row.get("status")),
                reference_min=ref_min,
                reference_max=ref_max,
            )
        )

    # Echo the most recent variant of the name back (the one the UI
    # is showing on the active checkup) instead of whatever casing
    # the URL contained.
    canonical = str(rows[-1]["marker_name"])
    return HealthMarkerHistoryOut(marker_name=canonical, points=points)


@router.get("/health/checkups", response_model=HealthCheckupsListOut)
def list_health_checkups() -> HealthCheckupsListOut:
    with get_db() as conn:
        rows = fetch_all(
            conn,
            """
            SELECT id, date, marker_name, value, unit,
                   reference_min, reference_max, status, source, created_at
            FROM health_checkups
            ORDER BY date DESC, id ASC
            """,
        )

    groups: dict[str, list[HealthMarkerOut]] = {}
    for row in rows:
        date = str(row["date"])
        value = _to_float(row.get("value")) or 0.0
        ref_min = _to_float(row.get("reference_min"))
        ref_max = _to_float(row.get("reference_max"))
        status = _normalize_status(value, ref_min, ref_max, row.get("status"))
        marker = HealthMarkerOut(
            id=int(row["id"]),
            marker_name=str(row["marker_name"]),
            value=value,
            unit=row.get("unit"),
            reference_min=ref_min,
            reference_max=ref_max,
            status=status,
            source=row.get("source") or "manual",
            created_at=row.get("created_at"),
        )
        groups.setdefault(date, []).append(marker)

    checkups = [
        HealthCheckupGroupOut(date=date, markers=markers)
        for date, markers in groups.items()
    ]
    return HealthCheckupsListOut(checkups=checkups)
