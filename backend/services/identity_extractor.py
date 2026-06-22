from __future__ import annotations

import logging
from difflib import SequenceMatcher
from typing import Any

from database import execute, fetch_all, fetch_one
from services.llm_client import parse_json_object
from services.llm_client_shared import call_claude

logger = logging.getLogger("identity_extractor")

VALID_CATEGORIES = frozenset({"behavior", "pattern", "value", "trigger"})
_SIMILARITY_THRESHOLD = 0.72

PROMPT = """
Проанализируй это сообщение пользователя.
Если в нём есть вывод о характере, паттерне поведения или ценностях — извлеки его.

Примеры выводов:
- "тянет всё сам, не делегирует"
- "в стрессе тратит больше на еду"
- "работает лучше ночью"
- "избегает конфликтов"

Ответь JSON:
{"found": true, "category": "behavior", "insight": "...", "confidence": 0.6}
или
{"found": false}

category — одно из: behavior, pattern, value, trigger
confidence — число от 0 до 1
"""


def _normalize_text(text: str) -> str:
    return " ".join(text.lower().split())


def _is_similar(a: str, b: str) -> bool:
    left = _normalize_text(a)
    right = _normalize_text(b)
    if not left or not right:
        return False
    if left == right:
        return True
    if len(left) >= 10 and len(right) >= 10 and (left in right or right in left):
        return True
    return SequenceMatcher(None, left, right).ratio() >= _SIMILARITY_THRESHOLD


def _find_similar(conn, insight: str) -> dict[str, Any] | None:
    rows = fetch_all(
        conn,
        """
        SELECT id, category, insight, confidence, evidence_count
        FROM identity_model
        """,
    )
    for row in rows:
        if _is_similar(insight, str(row.get("insight") or "")):
            return row
    return None


def _clamp_confidence(value: Any) -> float:
    try:
        confidence = float(value)
    except (TypeError, ValueError):
        confidence = 0.5
    return max(0.0, min(1.0, confidence))


async def extract_identity(
    message: str, conn, api_key: str
) -> dict[str, Any] | None:
    """Analyze one user message and persist an identity insight when found."""
    text = (message or "").strip()
    if not text or not api_key.strip():
        return None

    prompt = f"{PROMPT.strip()}\n\nСообщение: {text}"

    try:
        raw = await call_claude(prompt, api_key=api_key, max_tokens=256, temperature=0)
    except Exception:
        logger.exception("identity_extractor: LLM call failed")
        return None

    data = parse_json_object(raw)
    if not data.get("found"):
        return None

    category = str(data.get("category") or "").strip().lower()
    if category not in VALID_CATEGORIES:
        category = "behavior"

    insight = str(data.get("insight") or "").strip()
    if not insight:
        logger.info("identity_extractor: found=true but empty insight; skipping")
        return None
    insight = insight[:500]

    confidence = _clamp_confidence(data.get("confidence", 0.5))

    existing = _find_similar(conn, insight)
    if existing is not None:
        row_id = int(existing["id"])
        evidence_count = int(existing.get("evidence_count") or 1) + 1
        merged_confidence = max(
            _clamp_confidence(existing.get("confidence")),
            confidence,
        )
        execute(
            conn,
            """
            UPDATE identity_model
               SET evidence_count = ?,
                   confidence = ?,
                   updated_at = datetime('now')
             WHERE id = ?
            """,
            (evidence_count, merged_confidence, row_id),
        )
        logger.info(
            "identity_extractor: merged insight id=%s evidence_count=%s",
            row_id,
            evidence_count,
        )
        return fetch_one(
            conn,
            """
            SELECT id, category, insight, confidence, evidence_count,
                   created_at, updated_at
            FROM identity_model
            WHERE id = ?
            """,
            (row_id,),
        )

    row_id = execute(
        conn,
        """
        INSERT INTO identity_model (category, insight, confidence, evidence_count)
        VALUES (?, ?, ?, 1)
        """,
        (category, insight, confidence),
    )
    logger.info(
        "identity_extractor: saved insight id=%s category=%s",
        row_id,
        category,
    )
    return fetch_one(
        conn,
        """
        SELECT id, category, insight, confidence, evidence_count,
               created_at, updated_at
        FROM identity_model
        WHERE id = ?
        """,
        (row_id,),
    )
