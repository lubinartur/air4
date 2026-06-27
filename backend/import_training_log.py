#!/usr/bin/env python3
"""Import workouts from an ARCH training log Markdown file."""

from __future__ import annotations

import json
import re
import sqlite3
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from database import fetch_one, get_db, init_db

SOURCE = "arch"

_MONTHS_RU_GEN = (
    "",
    "января",
    "февраля",
    "марта",
    "апреля",
    "мая",
    "июня",
    "июля",
    "августа",
    "сентября",
    "октября",
    "ноября",
    "декабря",
)

DATE_IN_PARENS = re.compile(r"\((\d{2})\.(\d{2})\.(\d{4})\)")
DAY_HEADER = re.compile(r"День\s+\d+\s*[—\-]\s*(.+?)\s*\(", re.I)
CARDIO_HEADER = re.compile(r"Кардио\s*[—\-]\s*(.+?)\s*\(", re.I)
SET_CELL = re.compile(r"(\d+(?:[.,]\d+)?)\s*[×x*]\s*(\d+)")
NOTES_LINE = re.compile(r"^\s*(?:\*\*)?Заметки:\s*(.*)", re.I | re.DOTALL)
MINUTES_RE = re.compile(r"(\d+)")
METERS_RE = re.compile(r"(\d+)")
HR_RE = re.compile(r"(\d+)")


@dataclass
class ParsedWorkout:
    date: str
    workout_type: str
    duration: int | None = None
    exercises: list[dict[str, Any]] = field(default_factory=list)
    notes: str | None = None


def _strip_heading(line: str) -> str:
    return re.sub(r"^#+\s*", "", line).strip()


def _ddmmyyyy_to_iso(day: str, month: str, year: str) -> str:
    return f"{year}-{month}-{day}"


def _split_table_row(line: str) -> list[str]:
    return [cell.strip() for cell in line.strip().strip("|").split("|")]


def _is_table_separator(line: str) -> bool:
    cells = _split_table_row(line)
    return bool(cells) and all(re.fullmatch(r"[\s:\-—–]+", cell or "") for cell in cells)


def _parse_set_cell(cell: str) -> dict[str, float | int] | None:
    text = (cell or "").strip()
    if not text or text in {"—", "-", "–", "–"}:
        return None

    match = SET_CELL.search(text.replace(",", "."))
    if match:
        weight = float(match.group(1))
        reps = int(match.group(2))
        return {"weight": weight, "reps": reps}

    reps_only = re.fullmatch(r"(\d+)", text)
    if reps_only:
        return {"weight": 0, "reps": int(reps_only.group(1))}

    return None


def _parse_exercise_table(lines: list[str]) -> list[dict[str, Any]]:
    exercises: list[dict[str, Any]] = []
    header_seen = False

    for line in lines:
        if "|" not in line:
            continue
        if _is_table_separator(line):
            header_seen = True
            continue

        cells = _split_table_row(line)
        if not cells:
            continue

        first = cells[0].lower()
        if "упражнение" in first:
            header_seen = True
            continue
        if not header_seen:
            continue

        name = cells[0].strip()
        if not name:
            continue

        sets: list[dict[str, float | int]] = []
        for cell in cells[1:]:
            parsed = _parse_set_cell(cell)
            if parsed is not None:
                sets.append(parsed)

        exercises.append({"name": name, "sets": sets})

    return exercises


def _parse_minutes(value: str) -> int | None:
    match = MINUTES_RE.search(value or "")
    return int(match.group(1)) if match else None


def _parse_meters(value: str) -> int | None:
    match = METERS_RE.search((value or "").replace(" ", ""))
    return int(match.group(1)) if match else None


def _parse_hr(value: str) -> int | None:
    match = HR_RE.search(value or "")
    return int(match.group(1)) if match else None


def _parse_cardio_table(lines: list[str]) -> tuple[int | None, int | None, int | None]:
    time_min: int | None = None
    distance_m: int | None = None
    avg_hr: int | None = None
    header_seen = False

    for line in lines:
        if "|" not in line:
            continue
        if _is_table_separator(line):
            header_seen = True
            continue

        cells = _split_table_row(line)
        if not cells:
            continue

        lower = [cell.lower() for cell in cells]
        if any("время" in cell for cell in lower) or any("дистан" in cell for cell in lower):
            header_seen = True
            continue
        if not header_seen:
            continue

        if len(cells) >= 3:
            time_min = _parse_minutes(cells[0]) or time_min
            distance_m = _parse_meters(cells[1]) or distance_m
            avg_hr = _parse_hr(cells[2]) or avg_hr
        elif len(cells) == 2:
            key, value = lower[0], cells[1]
            if "время" in key:
                time_min = _parse_minutes(value)
            elif "дистан" in key:
                distance_m = _parse_meters(value)
            elif "пульс" in key:
                avg_hr = _parse_hr(value)

    return time_min, distance_m, avg_hr


def _extract_notes(lines: list[str]) -> str | None:
    parts: list[str] = []
    for line in lines:
        match = NOTES_LINE.match(line.strip())
        if match:
            text = match.group(1).strip()
            if text:
                parts.append(text)
    if not parts:
        return None
    return " ".join(parts)


def _infer_workout_type(title: str, kind: str) -> str:
    if kind == "cardio":
        return "cardio"

    lowered = title.lower()
    if any(token in lowered for token in ("yoga", "йога", "pilates")):
        return "yoga"
    if any(token in lowered for token in ("stretch", "растяж")):
        return "stretch"
    if any(
        token in lowered
        for token in (
            "upper",
            "lower",
            "push",
            "pull",
            "legs",
            "низ",
            "верх",
            "силов",
        )
    ):
        return "strength"
    return "other"


def _build_cardio_notes(modality: str, distance_m: int | None, time_min: int | None, avg_hr: int | None) -> str:
    parts: list[str] = [f"{modality}:"]
    if distance_m is not None:
        parts.append(f"{distance_m}м")
    if time_min is not None:
        parts.append(f"за {time_min} мин")
    note = " ".join(parts)
    if avg_hr is not None:
        note += f", пульс {avg_hr} bpm"
    return note


def _parse_section(meta: dict[str, str], lines: list[str]) -> ParsedWorkout | None:
    kind = meta["kind"]
    title = meta.get("title", "")
    date_iso = meta["date"]
    notes = _extract_notes(lines)

    if kind == "cardio":
        modality = meta.get("modality") or title or "Кардио"
        time_min, distance_m, avg_hr = _parse_cardio_table(lines)
        cardio_notes = _build_cardio_notes(modality, distance_m, time_min, avg_hr)
        if notes:
            cardio_notes = f"{cardio_notes}. {notes}"
        return ParsedWorkout(
            date=date_iso,
            workout_type="cardio",
            duration=time_min,
            exercises=[],
            notes=cardio_notes,
        )

    exercises = _parse_exercise_table(lines)
    workout_type = _infer_workout_type(title, kind)
    if not notes:
        notes = title or None
    elif title and title not in notes:
        notes = f"{title}. {notes}"

    return ParsedWorkout(
        date=date_iso,
        workout_type=workout_type,
        duration=None,
        exercises=exercises,
        notes=notes,
    )


def _iter_workout_sections(text: str) -> list[tuple[dict[str, str], list[str]]]:
    sections: list[tuple[dict[str, str], list[str]]] = []
    current_meta: dict[str, str] | None = None
    buffer: list[str] = []

    def flush() -> None:
        nonlocal current_meta, buffer
        if current_meta is not None:
            sections.append((current_meta, buffer))
        buffer = []

    for raw_line in text.splitlines():
        stripped = _strip_heading(raw_line)
        date_match = DATE_IN_PARENS.search(stripped)
        day_match = DAY_HEADER.search(stripped)
        cardio_match = CARDIO_HEADER.search(stripped)

        if date_match and (day_match or cardio_match):
            flush()
            date_iso = _ddmmyyyy_to_iso(
                date_match.group(1),
                date_match.group(2),
                date_match.group(3),
            )
            if cardio_match:
                current_meta = {
                    "kind": "cardio",
                    "modality": cardio_match.group(1).strip(),
                    "title": stripped,
                    "date": date_iso,
                }
            else:
                current_meta = {
                    "kind": "strength",
                    "title": day_match.group(1).strip() if day_match else stripped,
                    "date": date_iso,
                }
            continue

        if current_meta is not None:
            buffer.append(raw_line)

    flush()
    return sections


def _workout_to_dict(parsed: ParsedWorkout) -> dict[str, Any]:
    return {
        "date": parsed.date,
        "type": parsed.workout_type,
        "duration": parsed.duration,
        "exercises": parsed.exercises,
        "notes": parsed.notes,
    }


def parse_training_log(content: str) -> list[dict[str, Any]]:
    workouts: list[dict[str, Any]] = []
    for meta, lines in _iter_workout_sections(content):
        parsed = _parse_section(meta, lines)
        if parsed is not None:
            workouts.append(_workout_to_dict(parsed))
    return workouts


def import_to_db(workouts: list[dict[str, Any]], db: Any) -> dict[str, Any]:
    imported = 0
    skipped = 0
    saved: list[dict[str, Any]] = []
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    for workout in workouts:
        workout_date = str(workout["date"])
        workout_type = workout.get("type")
        if _duplicate_exists(db, workout_date, workout_type):
            skipped += 1
            continue

        exercises_raw = workout.get("exercises")
        if isinstance(exercises_raw, str):
            exercises_json = exercises_raw
        else:
            exercises_json = json.dumps(exercises_raw or [], ensure_ascii=False)

        cur = db.execute(
            """
            INSERT INTO workouts (
                date, type, duration, exercises, notes, source, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                workout_date,
                workout_type,
                workout.get("duration"),
                exercises_json,
                workout.get("notes"),
                SOURCE,
                now,
            ),
        )
        workout_id = int(cur.lastrowid or 0)
        row = fetch_one(db, "SELECT * FROM workouts WHERE id = ?", (workout_id,))
        if row is not None:
            saved.append(row)
        imported += 1

    return {"imported": imported, "skipped": skipped, "workouts": saved}


def _duplicate_exists(conn: sqlite3.Connection, workout_date: str, workout_type: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM workouts WHERE date = ? AND type = ? LIMIT 1",
        (workout_date, workout_type),
    ).fetchone()
    return row is not None


def _format_ru_date(iso_date: str) -> str:
    try:
        _year_s, month_s, day_s = iso_date.split("-", 2)
        month = int(month_s)
        day = int(day_s)
    except (TypeError, ValueError, IndexError):
        return iso_date
    if month < 1 or month > 12:
        return iso_date
    return f"{day} {_MONTHS_RU_GEN[month]}"


def _workout_short_label(row: dict[str, Any]) -> str:
    notes = str(row.get("notes") or "").strip()
    if notes:
        label = notes.split(".")[0].split(":")[0].strip()
        if label:
            return label
    workout_type = str(row.get("type") or "").strip()
    return workout_type or "тренировка"


def build_training_import_chat_notice(
    db: Any,
    imported: int,
    skipped: int,
) -> str | None:
    """Build a chat-visible notice after a training-log import."""
    if imported <= 0 and skipped <= 0:
        return None

    summary = f"Импортировано {imported} тренировок"
    if skipped > 0:
        summary += f", {skipped} пропущено"

    latest = fetch_one(
        db,
        """
        SELECT date, type, notes
        FROM workouts
        ORDER BY date DESC, id DESC
        LIMIT 1
        """,
    )
    if latest is not None:
        date_label = _format_ru_date(str(latest.get("date") or ""))
        workout_label = _workout_short_label(latest)
        summary += f". Последняя: {date_label}, {workout_label}"

    return f"[Система]: {summary}."


def import_training_log(path: Path) -> tuple[int, int]:
    text = path.read_text(encoding="utf-8")
    workouts = parse_training_log(text)

    init_db()
    with get_db() as conn:
        result = import_to_db(workouts, conn)
        conn.commit()

    return result["imported"], result["skipped"]


def main() -> int:
    if len(sys.argv) != 2:
        print(
            "Usage: python3 import_training_log.py path/to/training_log.md",
            file=sys.stderr,
        )
        return 1

    path = Path(sys.argv[1]).expanduser()
    if not path.is_file():
        print(f"File not found: {path}", file=sys.stderr)
        return 1

    try:
        imported, skipped = import_training_log(path)
    except OSError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    print(f"{imported} workouts imported, {skipped} skipped (duplicates)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
