"""Persistence helpers for the cross-session chat log.

A single flat table (`chat_messages`) keeps a chronological record of every
user / assistant exchange. The chat router writes both sides of an exchange
after the LLM responds; the prompt builder reads the most recent N rows so
that AIR4 can reference earlier conversations.
"""

from __future__ import annotations

import logging
from typing import Any

from database import execute, fetch_all

logger = logging.getLogger("chat_history")

_ROLE_USER = "user"
_ROLE_ASSISTANT = "assistant"
_VALID_ROLES = {_ROLE_USER, _ROLE_ASSISTANT}


def save_chat_message(
    db: Any, role: str, content: str, page: str | None = None
) -> int | None:
    """Insert a single chat message. Returns the new row id, or None on
    failure / on empty content. Unknown roles are coerced to 'user'."""
    text = (content or "").strip()
    if not text:
        return None
    role_norm = role if role in _VALID_ROLES else _ROLE_USER
    page_value = (page or "").strip() or None
    try:
        return execute(
            db,
            """
            INSERT INTO chat_messages (role, content, page, created_at)
            VALUES (?, ?, ?, datetime('now'))
            """,
            (role_norm, text, page_value),
        )
    except Exception:
        logger.exception("Failed to persist chat message (role=%s)", role)
        return None


def save_exchange(
    db: Any,
    *,
    user_message: str,
    assistant_message: str,
    page: str | None = None,
) -> None:
    """Persist a user message and the assistant reply in order."""
    save_chat_message(db, _ROLE_USER, user_message, page)
    save_chat_message(db, _ROLE_ASSISTANT, assistant_message, page)


def fetch_recent_chat_messages(
    db: Any, limit: int = 50
) -> list[dict[str, Any]]:
    """Return the most recent `limit` messages, oldest first."""
    if limit <= 0:
        return []
    rows = fetch_all(
        db,
        """
        SELECT id, role, content, page, created_at
        FROM chat_messages
        ORDER BY id DESC
        LIMIT ?
        """,
        (int(limit),),
    )
    items = [dict(r) for r in rows]
    items.reverse()
    return items
