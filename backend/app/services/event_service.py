"""Event memory: append-only events with pluggable embeddings and semantic search."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.event import Embedding, Event
from app.services.embedding_service import generate_embedding
from app.services.event_parser import parse_event
from app.services.similarity import cosine_similarity


def _processed_text(text: str) -> str:
    return " ".join(text.split())


def create_event(db: Session, text: str) -> Event:
    original = text
    processed_text = _processed_text(original)
    metadata = parse_event(processed_text)
    vector = generate_embedding(processed_text)

    event_id = str(uuid.uuid4())
    emb_id = str(uuid.uuid4())

    event = Event(
        id=event_id,
        timestamp=datetime.now(timezone.utc),
        original_text=original,
        processed_text=processed_text,
        metadata_=metadata,
        embedding_id=None,
    )
    embedding = Embedding(id=emb_id, event_id=event_id, vector=vector)
    db.add(event)
    db.add(embedding)
    db.flush()
    event.embedding_id = emb_id
    db.commit()
    db.refresh(event)
    return event


def list_events(db: Session, limit: int = 50) -> list[Event]:
    stmt = (
        select(Event)
        .order_by(Event.timestamp.desc(), Event.id.desc())
        .limit(max(1, min(limit, 500)))
    )
    return list(db.scalars(stmt).all())


def search_events(db: Session, query: str, limit: int = 10) -> list[Event]:
    q_vec = generate_embedding(_processed_text(query))
    stmt = select(Embedding)
    rows = db.scalars(stmt).all()
    scored: list[tuple[float, str]] = []
    for emb in rows:
        sim = cosine_similarity(q_vec, emb.vector)
        scored.append((sim, emb.event_id))
    scored.sort(key=lambda t: t[0], reverse=True)
    top_ids = [eid for _, eid in scored[: max(1, min(limit, 100))]]
    if not top_ids:
        return []
    ev_stmt = select(Event).where(Event.id.in_(top_ids))
    by_id = {e.id: e for e in db.scalars(ev_stmt).all()}
    return [by_id[i] for i in top_ids if i in by_id]
