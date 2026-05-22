from __future__ import annotations

from datetime import date

from fastapi import APIRouter, HTTPException, Query

from database import fetch_one, get_db
from schemas import CycleRange, FinanceCyclesOut, SummaryOut
from services.summary_loader import load_summary, salary_cycle_period

router = APIRouter()


def _validate_iso(value: str | None, *, name: str) -> str | None:
    if value is None:
        return None
    try:
        date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid {name} — expected YYYY-MM-DD.",
        ) from exc
    return value


@router.get("/summary", response_model=SummaryOut)
def get_summary(
    start: str | None = Query(
        None,
        description="Override cycle start (YYYY-MM-DD). Must be provided with end.",
    ),
    end: str | None = Query(
        None,
        description="Override cycle end (YYYY-MM-DD). Must be provided with start.",
    ),
) -> SummaryOut:
    """Summary for the active salary cycle (10th → 9th of next month) by default.

    Pass `start` and `end` (both required together) to query a custom range —
    used by timeline / history views. Totals and category breakdown exclude
    internal transfers (`is_internal_transfer = 0`).
    """
    if (start is None) != (end is None):
        raise HTTPException(
            status_code=400,
            detail="Provide both start and end, or neither.",
        )

    start = _validate_iso(start, name="start")
    end = _validate_iso(end, name="end")

    if start and end and start > end:
        raise HTTPException(status_code=400, detail="start must be <= end.")

    with get_db() as conn:
        return load_summary(conn, period_start=start, period_end=end)


@router.get("/finance/cycles", response_model=FinanceCyclesOut)
def get_cycles() -> FinanceCyclesOut:
    """Metadata about salary-cycle ranges available in the data.

    - `active` — the current cycle (today's 10th → 9th of next month).
    - `latest_with_data` — cycle that contains the most recent transaction.
    - `earliest_with_data` — cycle that contains the earliest transaction.

    Frontend uses this to pick a sensible default cycle to show, and to gate
    the navigation arrows.
    """
    active_start, active_end = salary_cycle_period()
    active = CycleRange(start=active_start, end=active_end)

    with get_db() as conn:
        row = fetch_one(
            conn,
            """
            SELECT MIN(date) AS first_date, MAX(date) AS last_date
            FROM transactions
            """,
        )

    first_date = (row or {}).get("first_date")
    last_date = (row or {}).get("last_date")

    earliest: CycleRange | None = None
    latest: CycleRange | None = None

    if first_date:
        try:
            d = date.fromisoformat(str(first_date)[:10])
            s, e = salary_cycle_period(d)
            earliest = CycleRange(start=s, end=e)
        except ValueError:
            pass

    if last_date:
        try:
            d = date.fromisoformat(str(last_date)[:10])
            s, e = salary_cycle_period(d)
            latest = CycleRange(start=s, end=e)
        except ValueError:
            pass

    return FinanceCyclesOut(
        active=active,
        latest_with_data=latest,
        earliest_with_data=earliest,
    )
