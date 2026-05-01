"""Time Layers v1: deterministic daily aggregation over events."""

from __future__ import annotations

from collections import Counter
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.daily_summary import DailySummary
from app.models.event import Event


def _day_bounds_utc(day: date) -> tuple[datetime, datetime]:
    start = datetime.combine(day, datetime.min.time(), tzinfo=timezone.utc)
    end_exclusive = datetime.combine(day + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
    return start, end_exclusive


def _domain_line(domain: str, n: int) -> str:
    """Single bullet for a domain count (deterministic copy)."""
    if domain == "training":
        noun = "training event" if n == 1 else "training events"
        return f"- {n} {noun}"
    if domain == "project":
        return f"- {n} project work"
    if domain == "idea":
        noun = "idea" if n == 1 else "ideas"
        return f"- {n} {noun}"
    if domain == "finance":
        noun = "finance event" if n == 1 else "finance events"
        return f"- {n} {noun}"
    if domain == "health":
        noun = "health event" if n == 1 else "health events"
        return f"- {n} {noun}"
    if domain == "emotion":
        noun = "emotion-related event" if n == 1 else "emotion-related events"
        return f"- {n} {noun}"
    if domain == "knowledge":
        noun = "knowledge event" if n == 1 else "knowledge events"
        return f"- {n} {noun}"
    if domain == "general":
        noun = "general event" if n == 1 else "general events"
        return f"- {n} {noun}"
    noun = f"{domain} event" if n == 1 else f"{domain} events"
    return f"- {n} {noun}"


def _build_summary_text(events: list[Event]) -> str:
    if not events:
        return "Today included:\n- No events recorded."

    concatenated = "\n".join(e.original_text for e in events)
    if not concatenated.strip():
        return "Today included:\n- No events recorded."

    domains = [str(e.metadata_.get("domain", "general")) for e in events]
    counts = Counter(domains)
    lines = ["Today included:"]
    for domain in sorted(counts.keys()):
        lines.append(_domain_line(domain, counts[domain]))
    return "\n".join(lines)


def get_daily_summary(db: Session, day: date) -> DailySummary | None:
    return db.scalar(select(DailySummary).where(DailySummary.date == day))


def generate_daily_summary(db: Session, day: date) -> DailySummary:
    start, end_excl = _day_bounds_utc(day)
    stmt = (
        select(Event)
        .where(Event.timestamp >= start, Event.timestamp < end_excl)
        .order_by(Event.timestamp)
    )
    events = list(db.scalars(stmt).all())

    summary_text = _build_summary_text(events)
    event_ids = [e.id for e in events]
    now = datetime.now(timezone.utc)

    existing = get_daily_summary(db, day)
    if existing:
        existing.summary_text = summary_text
        existing.event_ids = event_ids
        existing.created_at = now
        db.add(existing)
        db.commit()
        db.refresh(existing)
        return existing

    row = DailySummary(
        date=day,
        summary_text=summary_text,
        event_ids=event_ids,
        created_at=now,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def daily_summary_to_dict(row: DailySummary) -> dict[str, Any]:
    return {
        "id": row.id,
        "date": row.date.isoformat(),
        "summary_text": row.summary_text,
        "event_ids": row.event_ids,
        "created_at": row.created_at.isoformat(),
    }
