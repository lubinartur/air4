"""Event memory: append-only events with pluggable embeddings and cosine search over stored vectors."""

from __future__ import annotations

import hashlib
import math
import struct
import uuid
from datetime import datetime, timezone
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.event import Embedding, Event
from app.services.event_parser import parse_event

# Fixed dimension for MVP; swap provider without changing DB shape if you keep same dim.
_EMBEDDING_DIM = 384


def _l2_normalize(vec: list[float]) -> list[float]:
    norm = math.sqrt(sum(x * x for x in vec)) or 1.0
    return [x / norm for x in vec]


def _deterministic_embedding(text: str, dim: int = _EMBEDDING_DIM) -> list[float]:
    """Reproducible dense vector from text for local dev when no external provider is configured."""
    vec: list[float] = []
    block = hashlib.sha256(text.encode("utf-8")).digest()
    counter = 0
    while len(vec) < dim:
        block = hashlib.sha256(block + str(counter).encode()).digest()
        counter += 1
        for j in range(0, len(block) - 3, 4):
            u = struct.unpack(">I", block[j : j + 4])[0]
            vec.append((u / 4294967295.0) * 2.0 - 1.0)
            if len(vec) >= dim:
                break
    return _l2_normalize(vec)


def generate_embedding(text: str) -> list[float]:
    """
    Abstract entry point for embedding generation (wire OpenAI, sentence-transformers, etc. here).

    MVP: deterministic normalized vector so local runs work without API keys.
    """
    return _deterministic_embedding(text)


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    if len(a) != len(b) or not a:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


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
        sim = _cosine_similarity(q_vec, emb.vector)
        scored.append((sim, emb.event_id))
    scored.sort(key=lambda t: t[0], reverse=True)
    top_ids = [eid for _, eid in scored[: max(1, min(limit, 100))]]
    if not top_ids:
        return []
    ev_stmt = select(Event).where(Event.id.in_(top_ids))
    by_id = {e.id: e for e in db.scalars(ev_stmt).all()}
    return [by_id[i] for i in top_ids if i in by_id]
