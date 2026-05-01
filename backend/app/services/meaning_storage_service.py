"""Persistence and lifecycle for meanings: upsert by hypothesis_text, confidence evolution."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.meaning import Meaning

STATUS_CONFIRMED = "confirmed"
STATUS_REJECTED = "rejected"

_RESERVED_META = frozenset(
    {"confidence_score", "observation_count", "first_detected", "last_detected"}
)

_CONFIDENCE_STEP = 0.05
_CONFIDENCE_MAX = 0.95
_CONFIDENCE_MIN = 0.1


def _clamp_initial(conf: float) -> float:
    return max(_CONFIDENCE_MIN, min(_CONFIDENCE_MAX, round(float(conf), 2)))


def _merge_extra_metadata(existing: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
    out = dict(existing)
    for k, v in incoming.items():
        if k in _RESERVED_META:
            continue
        if k == "supporting_weeks" and isinstance(v, list):
            prev = out.get(k) or []
            out[k] = sorted(set(prev) | set(v))
        elif k == "supporting_meanings" and isinstance(v, list):
            out[k] = list(dict.fromkeys((out.get(k) or []) + v))
        elif k == "week_start_date" and v is not None:
            prev_w = out.get("week_start_date")
            seen: list[str] = list(out.get("seen_weeks") or [])
            if prev_w and prev_w not in seen:
                seen.append(str(prev_w))
            sv = str(v)
            if sv not in seen:
                seen.append(sv)
            out["seen_weeks"] = sorted(set(seen))
            out[k] = sv
        else:
            out[k] = v
    return out


def _get_by_hypothesis_text(db: Session, hypothesis_text: str) -> Meaning | None:
    return db.scalar(
        select(Meaning)
        .where(Meaning.hypothesis_text == hypothesis_text)
        .order_by(Meaning.created_at.asc())
        .limit(1)
    )


def store_hypothesis(
    db: Session,
    *,
    hypothesis_text: str,
    source: str,
    related_event_ids: list[str],
    extra_metadata: dict[str, Any],
    initial_confidence: float,
    status: str = "hypothesis",
) -> Meaning:
    """
    Insert or update a Meaning keyed by ``hypothesis_text`` (single row per text).

    Updates bump ``observation_count``, raise ``confidence_score`` by a fixed step
    up to ``_CONFIDENCE_MAX``, and refresh ``last_detected``. Preserves
    ``confirmed`` / ``rejected`` status.
    """
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    existing = _get_by_hypothesis_text(db, hypothesis_text)

    if existing is None:
        meta = _merge_extra_metadata({}, extra_metadata)
        meta["confidence_score"] = _clamp_initial(initial_confidence)
        meta["observation_count"] = 1
        meta["first_detected"] = now_iso
        meta["last_detected"] = now_iso
        row = Meaning(
            hypothesis_text=hypothesis_text,
            status=status,
            related_event_ids=list(dict.fromkeys(related_event_ids)),
            source=source,
            metadata_=meta,
            created_at=now,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return row

    meta = _merge_extra_metadata(dict(existing.metadata_), extra_metadata)
    oc = int(meta.get("observation_count", 1))
    meta["observation_count"] = oc + 1
    prev_conf = float(meta.get("confidence_score", initial_confidence))
    meta["confidence_score"] = round(min(_CONFIDENCE_MAX, prev_conf + _CONFIDENCE_STEP), 2)
    meta["last_detected"] = now_iso
    if "first_detected" not in meta:
        meta["first_detected"] = existing.created_at.isoformat()

    existing.metadata_ = meta
    existing.related_event_ids = list(
        dict.fromkeys((existing.related_event_ids or []) + related_event_ids)
    )
    if existing.status not in (STATUS_CONFIRMED, STATUS_REJECTED):
        existing.status = status
    db.add(existing)
    db.commit()
    db.refresh(existing)
    return existing
