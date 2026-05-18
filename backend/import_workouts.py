#!/usr/bin/env python3
"""Import workout sessions from a Coaich JSON export into workouts."""

from __future__ import annotations

import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

from database import DB_PATH, init_db

SOURCE = "coaich"

_TYPE_MAP = {
    "pull": "strength",
    "push": "strength",
    "legs": "strength",
}


def _map_workout_type(raw: str | None) -> str:
    key = (raw or "").strip().lower()
    return _TYPE_MAP.get(key, "strength")


def _date_from_started_at(started_at: str | None) -> str | None:
    if not started_at:
        return None
    s = started_at.strip()
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        return s[:10]
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt.date().isoformat()
    except ValueError:
        return None


def _build_exercises_json(exercises: list[dict]) -> str:
    out: list[dict] = []
    for ex in exercises:
        if not isinstance(ex, dict):
            continue
        name = str(ex.get("exerciseName") or ex.get("name") or "").strip()
        if not name:
            continue
        muscle = str(ex.get("muscleGroup") or "").strip() or None
        sets_in = ex.get("sets") or []
        sets_out: list[dict] = []
        if isinstance(sets_in, list):
            for s in sets_in:
                if not isinstance(s, dict):
                    continue
                try:
                    weight = float(s["weight"])
                    reps = int(s["reps"])
                except (KeyError, TypeError, ValueError):
                    continue
                sets_out.append({"weight": weight, "reps": reps})
        out.append(
            {
                "name": name,
                "muscleGroup": muscle,
                "sets": sets_out,
            }
        )
    return json.dumps(out, ensure_ascii=False)


def _duplicate_exists(conn, workout_date: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM workouts WHERE date = ? AND source = ? LIMIT 1",
        (workout_date, SOURCE),
    ).fetchone()
    return row is not None


def import_workouts(path: Path) -> tuple[int, int]:
    data = json.loads(path.read_text(encoding="utf-8"))
    sessions = data.get("workoutSessions")
    if not isinstance(sessions, list):
        raise ValueError('JSON must contain a "workoutSessions" array')

    init_db()

    imported = 0
    skipped_duplicates = 0
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    with sqlite3.connect(DB_PATH) as conn:
        for session in sessions:
            if not isinstance(session, dict):
                continue

            workout_date = _date_from_started_at(
                str(session.get("startedAt") or "")
            )
            if not workout_date:
                continue

            if _duplicate_exists(conn, workout_date):
                skipped_duplicates += 1
                continue

            duration_raw = session.get("durationMinutes")
            try:
                duration = int(duration_raw) if duration_raw is not None else None
            except (TypeError, ValueError):
                duration = None

            exercises_raw = session.get("exercises")
            exercises_json = _build_exercises_json(
                exercises_raw if isinstance(exercises_raw, list) else []
            )

            conn.execute(
                """
                INSERT INTO workouts (
                    date, type, duration, exercises, source, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    workout_date,
                    _map_workout_type(str(session.get("type") or "")),
                    duration,
                    exercises_json,
                    SOURCE,
                    now,
                ),
            )
            imported += 1

        conn.commit()

    return imported, skipped_duplicates


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: python3 import_workouts.py <coaich-backup.json>", file=sys.stderr)
        return 1

    path = Path(sys.argv[1]).expanduser()
    if not path.is_file():
        print(f"File not found: {path}", file=sys.stderr)
        return 1

    try:
        imported, skipped = import_workouts(path)
    except (json.JSONDecodeError, ValueError, OSError) as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1

    print(f"Imported {imported} workouts, skipped {skipped} duplicates")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
