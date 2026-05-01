"""Higher-level behavioral hypotheses from weekly (and monthly) time layers (v1, no LLM)."""

from __future__ import annotations

from typing import Any

from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.models.meaning import Meaning
from app.models.monthly_summary import MonthlySummary
from app.models.weekly_reflection import WeeklyReflection
from app.services.meaning_service import (
    H_HEALTH,
    SOURCE_V1 as WEEKLY_MEANING_SOURCE,
    STATUS_HYPOTHESIS,
    _domain_counts,
    _events_for_weekly,
    _top_domains_sharing_max,
)
from app.services.meaning_storage_service import store_hypothesis

BEHAVIOR_SOURCE = "behavior_hypothesis_v1"

H_TRAINING_DECREASED = "Training frequency decreased recently."
H_IDEA_LATE = "Ideas tend to appear late at night."
H_PROJECT_FOCUS = "Project work has been the main focus recently."
H_FATIGUE_REPEAT = "Fatigue or stress signals appear repeatedly."


def _training_count(events: list) -> int:
    return sum(1 for e in events if e.metadata_.get("domain") == "training")


def _project_dominates(events: list) -> bool:
    counts = _domain_counts(events)
    if not counts or counts.get("project", 0) == 0:
        return False
    tops = _top_domains_sharing_max(counts)
    return "project" in tops


def _insert_behavior_meaning(
    db: Session,
    *,
    hypothesis_text: str,
    related_event_ids: list[str],
    supporting_weeks: list[str],
    supporting_meanings: list[str],
    confidence_score: float,
    reference_month: str | None = None,
) -> Meaning:
    extra: dict[str, Any] = {
        "supporting_weeks": supporting_weeks,
        "supporting_meanings": supporting_meanings,
    }
    if reference_month is not None:
        extra["reference_month"] = reference_month
    return store_hypothesis(
        db,
        hypothesis_text=hypothesis_text,
        source=BEHAVIOR_SOURCE,
        related_event_ids=related_event_ids,
        extra_metadata=extra,
        initial_confidence=confidence_score,
        status=STATUS_HYPOTHESIS,
    )


def generate_behavior_hypotheses(db: Session) -> list[Meaning]:
    """Evaluate trend rules over the latest weekly reflections and related meanings."""
    created: list[Meaning] = []

    month_row = db.scalar(select(MonthlySummary).order_by(desc(MonthlySummary.month)).limit(1))
    reference_month: str | None = month_row.month if month_row is not None else None

    weeklies_desc = list(
        db.scalars(
            select(WeeklyReflection).order_by(desc(WeeklyReflection.week_start_date)).limit(8)
        ).all()
    )
    weeklies_chrono = list(reversed(weeklies_desc))

    if len(weeklies_chrono) >= 2:
        w_prev, w_last = weeklies_chrono[-2], weeklies_chrono[-1]
        ev_p = _events_for_weekly(db, w_prev)
        ev_l = _events_for_weekly(db, w_last)
        c_p, c_l = _training_count(ev_p), _training_count(ev_l)
        if c_p > 0 and c_l < c_p:
            rel = [e.id for e in ev_l if e.metadata_.get("domain") == "training"]
            rel += [e.id for e in ev_p if e.metadata_.get("domain") == "training"]
            created.append(
                _insert_behavior_meaning(
                    db,
                    hypothesis_text=H_TRAINING_DECREASED,
                    related_event_ids=rel,
                    supporting_weeks=[
                        w_prev.week_start_date.isoformat(),
                        w_last.week_start_date.isoformat(),
                    ],
                    supporting_meanings=[],
                    confidence_score=0.6,
                    reference_month=reference_month,
                )
            )

    idea_events: list = []
    supporting_weeks_set: set[str] = set()
    for w in weeklies_chrono:
        for e in _events_for_weekly(db, w):
            if e.metadata_.get("domain") == "idea":
                idea_events.append(e)
                supporting_weeks_set.add(w.week_start_date.isoformat())
    if len(idea_events) >= 2:
        late = sum(1 for e in idea_events if e.timestamp.hour >= 21)
        ratio = late / len(idea_events)
        if ratio > 0.5:
            conf = 0.7 if ratio >= 0.7 else 0.55
            created.append(
                _insert_behavior_meaning(
                    db,
                    hypothesis_text=H_IDEA_LATE,
                    related_event_ids=[e.id for e in idea_events],
                    supporting_weeks=sorted(supporting_weeks_set),
                    supporting_meanings=[],
                    confidence_score=conf,
                    reference_month=reference_month,
                )
            )

    proj_weeks: list[str] = []
    proj_event_ids: list[str] = []
    for w in weeklies_chrono:
        ev = _events_for_weekly(db, w)
        if _project_dominates(ev):
            proj_weeks.append(w.week_start_date.isoformat())
            proj_event_ids.extend(e.id for e in ev if e.metadata_.get("domain") == "project")
    if len(proj_weeks) >= 3:
        created.append(
            _insert_behavior_meaning(
                db,
                hypothesis_text=H_PROJECT_FOCUS,
                related_event_ids=proj_event_ids,
                supporting_weeks=sorted(proj_weeks),
                supporting_meanings=[],
                confidence_score=0.85,
                reference_month=reference_month,
            )
        )

    fatigue_meanings: list[Meaning] = []
    wk_from_meanings: set[str] = set()
    stmt_m = select(Meaning).where(Meaning.source == WEEKLY_MEANING_SOURCE)
    for row in db.scalars(stmt_m).all():
        if row.hypothesis_text == H_HEALTH or row.metadata_.get("detected_domain") == "health":
            fatigue_meanings.append(row)
            wk = row.metadata_.get("week_start_date")
            if wk:
                wk_from_meanings.add(str(wk))
    if len(wk_from_meanings) >= 2:
        created.append(
            _insert_behavior_meaning(
                db,
                hypothesis_text=H_FATIGUE_REPEAT,
                related_event_ids=[],
                supporting_weeks=sorted(wk_from_meanings),
                supporting_meanings=[x.id for x in fatigue_meanings],
                confidence_score=0.65 if len(wk_from_meanings) == 2 else 0.75,
                reference_month=reference_month,
            )
        )

    return created
