"""Monthly summaries from weekly reflections (deterministic, no LLM)."""

from __future__ import annotations

import calendar
import re
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.daily_summary import DailySummary
from app.models.event import Event
from app.models.monthly_summary import MonthlySummary
from app.models.weekly_reflection import WeeklyReflection


def _parse_month(month: str) -> tuple[int, int]:
    if not re.fullmatch(r"\d{4}-\d{2}", month):
        raise ValueError("month must be YYYY-MM")
    y = int(month[:4])
    m = int(month[5:7])
    if m < 1 or m > 12:
        raise ValueError("invalid month")
    return y, m


def _month_bounds(y: int, m: int) -> tuple[date, date]:
    _, last = calendar.monthrange(y, m)
    return date(y, m, 1), date(y, m, last)


def _week_overlaps_month(week_start: date, month_start: date, month_end: date) -> bool:
    week_end = week_start + timedelta(days=6)
    return week_start <= month_end and week_end >= month_start


def _monthly_domain_line(domain: str, n: int) -> str:
    if domain == "training":
        return f"- {n} training event{'s' if n != 1 else ''}"
    if domain == "project":
        if n == 1:
            return "- 1 project activity"
        return f"- {n} project activities"
    if domain == "idea":
        return f"- {n} ideas recorded" if n != 1 else "- 1 idea recorded"
    if domain == "finance":
        return f"- {n} finance event{'s' if n != 1 else ''}"
    if domain == "health":
        return f"- {n} health event{'s' if n != 1 else ''}"
    if domain == "emotion":
        return f"- {n} emotion-related event{'s' if n != 1 else ''}"
    if domain == "knowledge":
        return f"- {n} knowledge event{'s' if n != 1 else ''}"
    if domain == "general":
        return f"- {n} general event{'s' if n != 1 else ''}"
    return f"- {n} {domain} event{'s' if n != 1 else ''}"


def _most_active_domain(counts: Counter[str]) -> str | None:
    if not counts:
        return None
    max_n = max(counts.values())
    tied = sorted(d for d, c in counts.items() if c == max_n)
    return tied[0]


def _build_summary_text(domain_counts: Counter[str]) -> str:
    if not domain_counts:
        return (
            "This month included:\n"
            "- No events across weekly reflections.\n\n"
            "Most active domain: none."
        )

    lines = ["This month included:"]
    for domain in sorted(domain_counts.keys()):
        lines.append(_monthly_domain_line(domain, domain_counts[domain]))
    best = _most_active_domain(domain_counts)
    lines.append("")
    lines.append(f"Most active domain: {best}.")
    return "\n".join(lines)


def _weekly_rows_for_month(db: Session, month_start: date, month_end: date) -> list[WeeklyReflection]:
    cand_start = month_start - timedelta(days=6)
    stmt = select(WeeklyReflection).where(
        WeeklyReflection.week_start_date >= cand_start,
        WeeklyReflection.week_start_date <= month_end,
    )
    candidates = list(db.scalars(stmt).all())
    return [
        wr
        for wr in candidates
        if _week_overlaps_month(wr.week_start_date, month_start, month_end)
    ]


def _event_ids_from_weeklies(db: Session, weeklies: list[WeeklyReflection]) -> list[str]:
    ordered: list[str] = []
    seen: set[str] = set()
    for wr in sorted(weeklies, key=lambda w: w.week_start_date):
        for ds_id in wr.daily_summary_ids:
            ds = db.get(DailySummary, ds_id)
            if ds is None:
                continue
            for eid in ds.event_ids:
                if eid not in seen:
                    seen.add(eid)
                    ordered.append(eid)
    return ordered


def get_monthly_summary(db: Session, month: str) -> MonthlySummary | None:
    return db.scalar(select(MonthlySummary).where(MonthlySummary.month == month))


def generate_monthly_summary(db: Session, month: str) -> MonthlySummary:
    y, m = _parse_month(month)
    month_start, month_end = _month_bounds(y, m)

    weeklies = _weekly_rows_for_month(db, month_start, month_end)
    weekly_reflection_ids = [wr.id for wr in sorted(weeklies, key=lambda w: w.week_start_date)]

    ordered_event_ids = _event_ids_from_weeklies(db, weeklies)
    domain_counts: Counter[str] = Counter()
    if ordered_event_ids:
        ev_stmt = select(Event).where(Event.id.in_(ordered_event_ids))
        events = {e.id: e for e in db.scalars(ev_stmt).all()}
        for eid in ordered_event_ids:
            ev = events.get(eid)
            if ev is not None:
                domain_counts[str(ev.metadata_.get("domain", "general"))] += 1

    summary_text = _build_summary_text(domain_counts)
    now = datetime.now(timezone.utc)

    existing = get_monthly_summary(db, month)
    if existing:
        existing.summary_text = summary_text
        existing.weekly_reflection_ids = weekly_reflection_ids
        existing.created_at = now
        db.add(existing)
        db.commit()
        db.refresh(existing)
        return existing

    row = MonthlySummary(
        month=month,
        summary_text=summary_text,
        weekly_reflection_ids=weekly_reflection_ids,
        created_at=now,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def monthly_summary_to_dict(row: MonthlySummary) -> dict[str, Any]:
    return {
        "id": row.id,
        "month": row.month,
        "summary_text": row.summary_text,
        "weekly_reflection_ids": row.weekly_reflection_ids,
        "created_at": row.created_at.isoformat(),
    }
