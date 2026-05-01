"""Weekly reflections from daily summaries (deterministic, no LLM)."""

from __future__ import annotations

from collections import Counter
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.daily_summary import DailySummary
from app.models.event import Event
from app.models.weekly_reflection import WeeklyReflection


def _week_dates(week_start: date) -> list[date]:
    return [week_start + timedelta(days=i) for i in range(7)]


def _weekly_domain_line(domain: str, n: int) -> str:
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


def _build_reflection_text(domain_counts: Counter[str]) -> str:
    if not domain_counts:
        return (
            "This week included:\n"
            "- No events across daily summaries.\n\n"
            "Most active domain: none."
        )

    lines = ["This week included:"]
    for domain in sorted(domain_counts.keys()):
        lines.append(_weekly_domain_line(domain, domain_counts[domain]))
    best = _most_active_domain(domain_counts)
    lines.append("")
    lines.append(f"Most active domain: {best}.")
    return "\n".join(lines)


def get_weekly_reflection(db: Session, week_start: date) -> WeeklyReflection | None:
    return db.scalar(select(WeeklyReflection).where(WeeklyReflection.week_start_date == week_start))


def generate_weekly_reflection(db: Session, week_start_date: date) -> WeeklyReflection:
    days = _week_dates(week_start_date)
    dailies: list[DailySummary] = []
    for d in days:
        row = db.scalar(select(DailySummary).where(DailySummary.date == d))
        if row is not None:
            dailies.append(row)

    daily_summary_ids = [ds.id for ds in sorted(dailies, key=lambda x: x.date)]

    ordered_event_ids: list[str] = []
    seen: set[str] = set()
    for ds in sorted(dailies, key=lambda x: x.date):
        for eid in ds.event_ids:
            if eid not in seen:
                seen.add(eid)
                ordered_event_ids.append(eid)

    domain_counts: Counter[str] = Counter()
    if ordered_event_ids:
        ev_stmt = select(Event).where(Event.id.in_(ordered_event_ids))
        events = {e.id: e for e in db.scalars(ev_stmt).all()}
        for eid in ordered_event_ids:
            ev = events.get(eid)
            if ev is not None:
                domain_counts[str(ev.metadata_.get("domain", "general"))] += 1

    reflection_text = _build_reflection_text(domain_counts)
    now = datetime.now(timezone.utc)

    existing = get_weekly_reflection(db, week_start_date)
    if existing:
        existing.reflection_text = reflection_text
        existing.daily_summary_ids = daily_summary_ids
        existing.created_at = now
        db.add(existing)
        db.commit()
        db.refresh(existing)
        return existing

    row = WeeklyReflection(
        week_start_date=week_start_date,
        reflection_text=reflection_text,
        daily_summary_ids=daily_summary_ids,
        created_at=now,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def weekly_reflection_to_dict(row: WeeklyReflection) -> dict[str, Any]:
    return {
        "id": row.id,
        "week_start_date": row.week_start_date.isoformat(),
        "reflection_text": row.reflection_text,
        "daily_summary_ids": row.daily_summary_ids,
        "created_at": row.created_at.isoformat(),
    }
