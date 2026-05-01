"""Auto confirm / reject meanings from observation metadata."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.meaning import Meaning

STATUS_HYPOTHESIS = "hypothesis"
STATUS_CONFIRMED = "confirmed"
STATUS_REJECTED = "rejected"

_AUTO_REJECT_AGE = timedelta(days=30)


def _aware(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def evaluate_meaning_confirmation(db: Session) -> dict:
    """
    Evaluate hypothesis meanings:

    - Auto-confirm: ``metadata.observation_count >= 3`` → ``confirmed``, set ``confirmed_at``.
    - Auto-reject: ``observation_count == 1`` and row older than 30 days → ``rejected``, set ``rejected_at``.

    Returns dict with ``confirmed`` and ``rejected`` ORM lists and ``checked`` (hypothesis rows examined).
    """
    now = datetime.now(timezone.utc)
    stmt = select(Meaning).where(Meaning.status == STATUS_HYPOTHESIS)
    candidates: list[Meaning] = list(db.scalars(stmt).all())
    checked = len(candidates)
    confirmed: list[Meaning] = []
    rejected: list[Meaning] = []

    for row in candidates:
        meta = dict(row.metadata_)
        oc = int(meta.get("observation_count", 0))
        age = now - _aware(row.created_at)

        if oc >= 3:
            row.status = STATUS_CONFIRMED
            meta["confirmed_at"] = now.isoformat()
            row.metadata_ = meta
            db.add(row)
            confirmed.append(row)
        elif oc == 1 and age > _AUTO_REJECT_AGE:
            row.status = STATUS_REJECTED
            meta["rejected_at"] = now.isoformat()
            row.metadata_ = meta
            db.add(row)
            rejected.append(row)

    if confirmed or rejected:
        db.commit()
        for r in confirmed + rejected:
            db.refresh(r)

    return {"confirmed": confirmed, "rejected": rejected, "checked": checked}
