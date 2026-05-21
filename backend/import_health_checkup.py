"""Import a blood-test checkup into the `health_checkups` table.

Usage:
    python3 import_health_checkup.py

The script is idempotent — running it twice will not duplicate markers
because (date, marker_name) is a UNIQUE constraint and we use INSERT OR REPLACE.
"""

from __future__ import annotations

import sys
from typing import Iterable

from database import execute, fetch_all, get_db, init_db

CHECKUP_DATE = "2026-03-12"

CHECKUP_DATA: list[tuple[str, float, str, float | None, float | None, str | None]] = [
    # (marker_name, value, unit, ref_min, ref_max, explicit_status)

    # CBC
    ("Hemoglobin", 174, "g/L", 130, 170, None),
    ("Hematocrit", 50.6, "%", 40, 50, None),
    ("RBC", 5.46, "E12/L", 4.5, 5.5, None),
    ("WBC", 7.3, "E9/L", 4.0, 9.0, None),
    ("Platelets", 216, "E9/L", 150, 400, None),
    ("Neutrophils", 3.20, "E9/L", 1.8, 7.5, None),
    ("Lymphocytes", 2.57, "E9/L", 1.0, 4.5, None),
    ("Eosinophils", 0.81, "E9/L", 0.0, 0.5, "HIGH"),

    # Biochemistry
    ("Creatinine", 98, "µmol/L", 62, 115, None),
    ("eGFR", 85, "ml/min", 90, None, "LOW"),
    ("CRP", 0.96, "mg/L", 0, 5.0, None),
    ("ALT", 33, "U/L", 0, 40, None),
    ("AST", 32, "U/L", 0, 40, None),
    ("GGT", 22, "U/L", 0, 55, None),

    # Lipids
    ("HDL Cholesterol", 0.8, "mmol/L", 1.0, None, "LOW"),

    # Hormones
    ("Testosterone Total", 73, "nmol/L", 10, 35, "HIGH"),
    ("Estradiol E2", 559, "pmol/L", 40, 160, "HIGH"),
    ("SHBG", 13, "nmol/L", 18, 54, "LOW"),
]


def compute_status(
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


def import_rows(
    date: str,
    rows: Iterable[tuple[str, float, str, float | None, float | None, str | None]],
) -> tuple[int, int, int]:
    """Returns (inserted, updated, total)."""
    init_db()
    inserted = 0
    updated = 0
    total = 0

    with get_db() as conn:
        for marker_name, value, unit, ref_min, ref_max, explicit in rows:
            total += 1
            status = compute_status(value, ref_min, ref_max, explicit)
            existing = conn.execute(
                "SELECT id FROM health_checkups WHERE date = ? AND marker_name = ?",
                (date, marker_name),
            ).fetchone()

            if existing is None:
                execute(
                    conn,
                    """
                    INSERT INTO health_checkups
                      (date, marker_name, value, unit, reference_min, reference_max,
                       status, source, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', datetime('now'))
                    """,
                    (date, marker_name, value, unit, ref_min, ref_max, status),
                )
                inserted += 1
            else:
                execute(
                    conn,
                    """
                    UPDATE health_checkups
                       SET value = ?, unit = ?, reference_min = ?, reference_max = ?,
                           status = ?, source = 'manual'
                     WHERE id = ?
                    """,
                    (value, unit, ref_min, ref_max, status, int(existing[0])),
                )
                updated += 1

    return inserted, updated, total


def main() -> int:
    print(f"Importing {len(CHECKUP_DATA)} markers for {CHECKUP_DATE}...")
    inserted, updated, total = import_rows(CHECKUP_DATE, CHECKUP_DATA)
    print(f"Done — inserted: {inserted}, updated: {updated}, total: {total}")

    with get_db() as conn:
        flagged = fetch_all(
            conn,
            """
            SELECT marker_name, value, unit, status
            FROM health_checkups
            WHERE date = ? AND status != 'NORMAL'
            ORDER BY status, marker_name
            """,
            (CHECKUP_DATE,),
        )

    if flagged:
        print()
        print("Out-of-range markers:")
        for row in flagged:
            print(
                f"  {row['status']:4s}  {row['marker_name']:<22s} {row['value']} {row['unit'] or ''}"
            )
    return 0


if __name__ == "__main__":
    sys.exit(main())
