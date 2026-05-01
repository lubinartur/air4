"""Deterministic meanings from weekly time-layer patterns (v1, no LLM)."""

from __future__ import annotations

from collections import Counter
from datetime import date
from typing import Any

from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.models.daily_summary import DailySummary
from app.models.event import Event
from app.models.meaning import Meaning
from app.models.weekly_reflection import WeeklyReflection
from app.services.meaning_storage_service import store_hypothesis
from app.services.weekly_service import get_weekly_reflection

SOURCE_V1 = "weekly_pattern_v1"

STATUS_HYPOTHESIS = "hypothesis"
STATUS_CONFIRMED = "confirmed"
STATUS_REJECTED = "rejected"

H_PROJECT_DOMINANT = "Project work was the dominant activity this week."
H_TRAINING = "Training appeared consistently this week."
H_HEALTH = "Health or fatigue signals appeared this week."
H_IDEAS = "Multiple ideas were captured this week."


def _events_for_weekly(db: Session, weekly: WeeklyReflection) -> list[Event]:
    ordered_ids: list[str] = []
    seen: set[str] = set()
    for ds_id in weekly.daily_summary_ids:
        ds = db.get(DailySummary, ds_id)
        if ds is None:
            continue
        for eid in ds.event_ids:
            if eid not in seen:
                seen.add(eid)
                ordered_ids.append(eid)
    if not ordered_ids:
        return []
    stmt = select(Event).where(Event.id.in_(ordered_ids))
    by_id = {e.id: e for e in db.scalars(stmt).all()}
    return [by_id[i] for i in ordered_ids if i in by_id]


def _domain_counts(events: list[Event]) -> Counter[str]:
    return Counter(str(e.metadata_.get("domain", "general")) for e in events)


def _health_fatigue_signal_count(events: list[Event]) -> int:
    ids: set[str] = set()
    keywords = ("stress", "tired", "fatigue", "slept", "exhausted", "insomnia", "headache")
    for e in events:
        if e.metadata_.get("domain") == "health":
            ids.add(e.id)
            continue
        t = e.original_text.lower()
        if any(k in t for k in keywords):
            ids.add(e.id)
    return len(ids)


def _top_domains_sharing_max(counts: Counter[str]) -> list[str]:
    if not counts:
        return []
    max_n = max(counts.values())
    return sorted(d for d, c in counts.items() if c == max_n)


def _weekly_initial_confidence(event_count: int) -> float:
    return max(0.1, min(0.85, 0.4 + 0.05 * min(event_count, 10)))


def _add_meaning(
    db: Session,
    *,
    hypothesis_text: str,
    related_event_ids: list[str],
    week_key: str,
    detected_domain: str | None,
    event_count: int,
) -> Meaning:
    return store_hypothesis(
        db,
        hypothesis_text=hypothesis_text,
        source=SOURCE_V1,
        related_event_ids=related_event_ids,
        extra_metadata={
            "week_start_date": week_key,
            "detected_domain": detected_domain,
            "event_count": event_count,
        },
        initial_confidence=_weekly_initial_confidence(event_count),
        status=STATUS_HYPOTHESIS,
    )


def generate_meanings_for_week(db: Session, week_start_date: date) -> list[Meaning]:
    weekly = get_weekly_reflection(db, week_start_date)
    if weekly is None:
        return []

    events = _events_for_weekly(db, weekly)
    week_key = week_start_date.isoformat()
    out: list[Meaning] = []

    counts = _domain_counts(events)
    training_n = counts.get("training", 0)
    project_n = counts.get("project", 0)
    idea_n = counts.get("idea", 0)
    hf_n = _health_fatigue_signal_count(events)

    tops = _top_domains_sharing_max(counts)
    if tops and project_n > 0 and "project" in tops:
        out.append(
            _add_meaning(
                db,
                hypothesis_text=H_PROJECT_DOMINANT,
                related_event_ids=[e.id for e in events if e.metadata_.get("domain") == "project"],
                week_key=week_key,
                detected_domain="project",
                event_count=project_n,
            )
        )

    if training_n >= 2:
        out.append(
            _add_meaning(
                db,
                hypothesis_text=H_TRAINING,
                related_event_ids=[e.id for e in events if e.metadata_.get("domain") == "training"],
                week_key=week_key,
                detected_domain="training",
                event_count=training_n,
            )
        )

    if hf_n >= 1:
        hf_ids = [
            e.id
            for e in events
            if e.metadata_.get("domain") == "health"
            or any(
                k in e.original_text.lower()
                for k in ("stress", "tired", "fatigue", "slept", "exhausted", "insomnia", "headache")
            )
        ]
        out.append(
            _add_meaning(
                db,
                hypothesis_text=H_HEALTH,
                related_event_ids=hf_ids,
                week_key=week_key,
                detected_domain="health",
                event_count=hf_n,
            )
        )

    if idea_n >= 2:
        out.append(
            _add_meaning(
                db,
                hypothesis_text=H_IDEAS,
                related_event_ids=[e.id for e in events if e.metadata_.get("domain") == "idea"],
                week_key=week_key,
                detected_domain="idea",
                event_count=idea_n,
            )
        )

    return out


def list_meanings(db: Session, limit: int = 100) -> list[Meaning]:
    stmt = (
        select(Meaning)
        .order_by(desc(Meaning.created_at))
        .limit(max(1, min(limit, 500)))
    )
    return list(db.scalars(stmt).all())


def get_meaning(db: Session, meaning_id: str) -> Meaning | None:
    return db.get(Meaning, meaning_id)


def confirm_meaning(db: Session, meaning_id: str) -> Meaning | None:
    row = get_meaning(db, meaning_id)
    if row is None:
        return None
    row.status = STATUS_CONFIRMED
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def reject_meaning(db: Session, meaning_id: str) -> Meaning | None:
    row = get_meaning(db, meaning_id)
    if row is None:
        return None
    row.status = STATUS_REJECTED
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def meaning_to_dict(row: Meaning) -> dict[str, Any]:
    return {
        "id": row.id,
        "created_at": row.created_at.isoformat(),
        "hypothesis_text": row.hypothesis_text,
        "status": row.status,
        "related_event_ids": row.related_event_ids,
        "source": row.source,
        "metadata": row.metadata_,
    }
