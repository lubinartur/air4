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

CheckupRow = tuple[str, float, str, float | None, float | None, str | None]

CHECKUP_DATA: list[CheckupRow] = [
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

CHECKUP_DATA_DEC: list[CheckupRow] = [
    # Hormones — pre-cycle baseline
    ("Testosterone Total", 27.6, "nmol/L", 10, 35, None),
    ("Estradiol E2", 191, "pmol/L", 40, 160, "HIGH"),
    ("SHBG", 19, "nmol/L", 18, 54, None),
    ("Prolactin", 407, "mU/L", 86, 324, "HIGH"),

    # Lipids
    ("Triglycerides", 0.86, "mmol/L", None, 2.0, None),
]

CHECKUP_DATA_2019: list[CheckupRow] = [
    # Hormones
    ("Testosterone Total", 16.84, "nmol/L", 10, 35, None),
    ("LH", 2.96, "IU/L", 1.7, 8.6, None),
    ("Estradiol E2", 114, "pmol/L", 40, 160, None),

    # CBC
    ("Hemoglobin", 168, "g/L", 130, 170, None),
    ("Hematocrit", 48.6, "%", 40, 50, None),

    # Biochemistry
    ("ALT", 23, "U/L", 0, 40, None),
    ("AST", 31, "U/L", 0, 40, None),
    ("GGT", 21, "U/L", 0, 55, None),
    ("Creatinine", 91.7, "µmol/L", 62, 115, None),
    ("eGFR", 94, "ml/min", 90, None, None),
    ("Glucose", 5.06, "mmol/L", 3.9, 6.1, None),
    ("Insulin", 8.7, "mU/L", 2.6, 24.9, None),

    # Lipids
    ("Total Cholesterol", 4.3, "mmol/L", None, 5.0, None),
    ("LDL Cholesterol", 2.97, "mmol/L", None, 3.0, None),
    ("HDL Cholesterol", 0.95, "mmol/L", 1.0, None, "LOW"),

    # Cardio risk markers
    ("Homocysteine", 17.1, "µmol/L", None, 15.0, "HIGH"),
    ("Uric Acid", 473, "µmol/L", 208, 428, "HIGH"),
]

CHECKUP_DATA_2025_NOV: list[CheckupRow] = [
    # Hormones — pre-cycle
    ("Testosterone Total", 14.5, "nmol/L", 10, 35, None),
    ("Free Testosterone", 0.43, "nmol/L", 0.2, 0.6, None),
    ("SHBG", 15, "nmol/L", 18, 54, "LOW"),
    ("Estradiol E2", 99, "pmol/L", 40, 160, None),
    ("FSH", 3.8, "IU/L", 1.5, 12.4, None),

    # CBC
    ("Hemoglobin", 162, "g/L", 130, 170, None),
    ("Hematocrit", 47.2, "%", 40, 50, None),
    ("RBC", 5.05, "E12/L", 4.5, 5.5, None),
    ("WBC", 7.6, "E9/L", 4.0, 9.0, None),
    ("Platelets", 194, "E9/L", 150, 400, None),

    # Biochemistry
    ("HbA1c", 5.2, "%", None, 5.7, None),
    ("ALT", 27, "U/L", 0, 40, None),

    # Lipids
    ("Total Cholesterol", 5.0, "mmol/L", None, 5.0, None),
    ("LDL Cholesterol", 3.2, "mmol/L", None, 3.0, "HIGH"),
    ("HDL Cholesterol", 1.0, "mmol/L", 1.0, None, None),
    ("Triglycerides", 2.29, "mmol/L", None, 2.0, None),
]

# SYNLAB Tallinn checkup — translated from Estonian lab printout.
# Canonical English marker names are reused wherever a prior checkup
# already covers the same marker (Hemoglobin, Hematocrit, RBC, …) so
# the trend chart on /health connects the dots across dates. Markers
# without a prior history (MCV, MCH, MCHC, MPV, …) use the standard
# English abbreviation. Reference ranges match the SYNLAB adult-male
# panel; ranges already used by other checkups in this file are
# repeated verbatim so a value comparing across dates stays apples-
# to-apples.
#
# Explicit HIGH overrides:
#   - LDL Cholesterol 3.0 mmol/L: at the lab's upper threshold; user
#     confirmed повышен.
#   - Triglycerides 1.99 mmol/L: above the recommended <1.7 mmol/L.
CHECKUP_DATA_2026_MAY: list[CheckupRow] = [
    # ---- CBC ----
    ("Hemoglobin", 170, "g/L", 130, 170, None),
    ("Hematocrit", 48.0, "%", 40, 50, None),
    ("RBC", 5.25, "E12/L", 4.5, 5.5, None),
    ("MCV", 91.4, "fL", 81, 100, None),
    ("MCH", 32.4, "pg", 27, 34, None),
    ("MCHC", 354, "g/L", 320, 360, None),
    ("WBC", 7.1, "E9/L", 4.0, 9.0, None),
    ("RDW", 12.5, "%", 11.5, 14.5, None),
    ("Platelets", 197, "E9/L", 150, 400, None),
    ("Plateletcrit", 0.23, "%", 0.18, 0.36, None),
    ("MPV", 11.4, "fL", 8.5, 12.0, None),
    ("PDW", 14.4, "fL", 9.0, 17.0, None),
    ("Immature Granulocytes %", 0.4, "%", None, 0.5, None),
    ("Normoblasts %", 0.0, "/100WBC", None, 0.0, None),
    ("Neutrophils", 3.37, "E9/L", 1.8, 7.5, None),
    ("Eosinophils", 0.34, "E9/L", 0.0, 0.5, None),
    ("Basophils", 0.04, "E9/L", 0.0, 0.2, None),
    ("Monocytes", 0.54, "E9/L", 0.1, 1.0, None),
    ("Lymphocytes", 2.78, "E9/L", 1.0, 4.5, None),
    ("Immature Granulocytes", 0.03, "E9/L", None, 0.10, None),
    ("Normoblasts", 0.00, "E9/L", None, 0.0, None),

    # ---- Liver enzymes ----
    ("ALT", 35, "U/L", 0, 50, None),
    ("AST", 23, "U/L", 0, 40, None),
    ("GGT", 23, "U/L", 0, 55, None),

    # ---- Lipid panel ----
    ("Total Cholesterol", 4.7, "mmol/L", None, 5.0, None),
    ("HDL Cholesterol", 1.1, "mmol/L", 1.0, None, None),
    # LDL: at threshold; explicit HIGH per user spec.
    ("LDL Cholesterol", 3.0, "mmol/L", None, 3.0, "HIGH"),
    ("Non-HDL Cholesterol", 3.6, "mmol/L", None, 3.8, None),
    # Triglycerides: above recommended <1.7; explicit HIGH per user spec.
    ("Triglycerides", 1.99, "mmol/L", None, 1.7, "HIGH"),

    # ---- Kidney function ----
    ("Creatinine", 88, "µmol/L", 62, 115, None),
    ("eGFR", 97.03, "mL/min/1.73m2", 90, None, None),

    # ---- Hormones ----
    ("Estradiol E2", 123.0, "pmol/L", 40, 160, None),
    ("Free Testosterone", 0.34, "nmol/L", 0.2, 0.6, None),
    ("SHBG", 19, "nmol/L", 18, 54, None),
    ("Testosterone Total", 13.0, "nmol/L", 10, 35, None),
    ("FSH", 4.3, "U/L", 1.5, 12.4, None),
    ("LH", 4.40, "U/L", 1.7, 8.6, None),
    ("Prolactin", 241, "mU/L", 86, 324, None),
]

CHECKUP_DATA_2022_SPERM: list[CheckupRow] = [
    # Spermogram
    ("Sperm Volume", 2.79, "ml", 1.5, None, None),
    ("Sperm Concentration", 66, "mln/ml", 16, None, None),
    ("Total Sperm Count", 178, "mln", 39, None, None),
    ("Progressive Motility", 70, "%", 32, None, None),
    ("Normal Morphology", 8, "%", 4, None, None),
    ("MAR IgG", 3, "%", None, 50, None),
    ("IL-6", 9.3, "ng/L", None, 7.0, "HIGH"),
]

# All checkups to import. Add new (date, rows) tuples here over time.
CHECKUPS: list[tuple[str, list[CheckupRow]]] = [
    ("2019-11-11", CHECKUP_DATA_2019),
    ("2022-04-22", CHECKUP_DATA_2022_SPERM),
    ("2025-11-17", CHECKUP_DATA_2025_NOV),
    ("2025-12-30", CHECKUP_DATA_DEC),
    ("2026-03-12", CHECKUP_DATA),
    ("2026-05-29", CHECKUP_DATA_2026_MAY),
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
    grand_inserted = 0
    grand_updated = 0
    grand_total = 0

    for date, rows in CHECKUPS:
        print(f"Importing {len(rows)} markers for {date}...")
        inserted, updated, total = import_rows(date, rows)
        print(f"  inserted: {inserted}, updated: {updated}, total: {total}")
        grand_inserted += inserted
        grand_updated += updated
        grand_total += total

    print()
    print(
        f"Total — inserted: {grand_inserted}, updated: {grand_updated}, "
        f"total: {grand_total}"
    )

    with get_db() as conn:
        flagged = fetch_all(
            conn,
            """
            SELECT date, marker_name, value, unit, status
            FROM health_checkups
            WHERE status != 'NORMAL'
            ORDER BY date DESC, status, marker_name
            """,
        )

    if flagged:
        print()
        print("Out-of-range markers:")
        for row in flagged:
            print(
                f"  {row['date']}  {row['status']:4s}  "
                f"{row['marker_name']:<22s} {row['value']} {row['unit'] or ''}"
            )
    return 0


if __name__ == "__main__":
    sys.exit(main())
