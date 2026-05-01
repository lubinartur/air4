"""Basic chat over event memory (MVP: semantic retrieval + simulated reply, no LLM)."""

from __future__ import annotations

import hashlib
from typing import Any

from sqlalchemy.orm import Session

from app.models.event import Event
from app.services.embedding_service import generate_embedding
from app.services.event_service import search_events


def _processed_text(text: str) -> str:
    return " ".join(text.split())


def _events_to_used(events: list[Event]) -> list[dict[str, Any]]:
    return [
        {
            "id": e.id,
            "original_text": e.original_text,
            "timestamp": e.timestamp.isoformat(),
        }
        for e in events
    ]


def _build_context_lines(events: list[Event]) -> list[str]:
    lines: list[str] = []
    for e in events:
        lines.append(f"- {e.original_text} ({e.timestamp.isoformat()})")
    return lines


def _build_prompt(message: str, context_lines: list[str]) -> str:
    system = "You are AIR4, a personal AI memory companion."
    context_block = "Recent relevant events:\n" + (
        "\n".join(context_lines) if context_lines else "(none)"
    )
    return (
        f"{system}\n\nContext:\n{context_block}\n\nUser message:\n{message}\n"
    )


def _simulated_answer(message: str, events: list[Event]) -> str:
    """Deterministic placeholder until an LLM is wired in."""
    if not events:
        return (
            "[AIR4] No matching events were found in memory. "
            "Add entries with POST /event. (Simulated response — no LLM.)"
        )
    key = hashlib.sha256(message.encode("utf-8")).hexdigest()[:10]
    return (
        f"[AIR4 simulated reply key={key}] Retrieved {len(events)} relevant event(s). "
        f"Question noted: {message[:120]}{'…' if len(message) > 120 else ''}. "
        "LLM is not enabled; this is a deterministic placeholder."
    )


def chat(db: Session, message: str) -> dict[str, Any]:
    """
    Answer a user message using stored events (semantic search + simulated reply).

    ``message`` is normalized the same way as event search. Requires ``db`` for
    ``search_events`` (session is not created inside this function).
    """
    processed = _processed_text(message)
    _ = generate_embedding(processed)

    retrieved = search_events(db, message, limit=20)
    top5 = retrieved[:5]

    context_lines = _build_context_lines(top5)
    _ = _build_prompt(message, context_lines)

    answer = _simulated_answer(message, top5)
    events_used = _events_to_used(top5)

    return {"answer": answer, "events_used": events_used}
