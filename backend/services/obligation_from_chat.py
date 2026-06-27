"""Apply obligation changes after the user confirms in chat.

Pending ``create_obligation`` actions are built by ``fact_extractor``
(``detect_obligation_from_fact``). This module only persists them when
``POST /api/chat/confirm-action`` calls :func:`apply_pending_obligation_action`.
"""

from __future__ import annotations

import logging
from typing import Any

from services.fact_extractor import persist_obligation

logger = logging.getLogger(__name__)


def apply_pending_obligation_action(
    db: Any, action: dict[str, Any]
) -> dict[str, Any] | None:
    """Persist a pending obligation action after user confirmation."""
    data = action.get("data") or {}
    name = str(data.get("name") or "").strip()
    if not name:
        return None
    return persist_obligation(
        db,
        name=name,
        monthly_payment=data.get("monthly_payment"),
        total_amount=data.get("total_amount"),
        remaining_amount=data.get("remaining_amount"),
    )
