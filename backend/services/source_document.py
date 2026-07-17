"""Finance Vertical — source document provenance helpers.

Chat attachment bytes stay in `chat_messages`; this module records metadata
in `source_documents` for downstream invoice / extraction workflows.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import logging
from typing import Any

from database import execute, fetch_one

logger = logging.getLogger("source_document")

_PDF_MIME = "application/pdf"


def _attachment_kind(mime_type: str) -> str | None:
    mime = (mime_type or "").strip().lower()
    if mime == _PDF_MIME:
        return "pdf"
    if mime.startswith("image/"):
        return "image"
    return None


def record_chat_attachment_source(
    db: Any,
    chat_message_id: int,
    attachment: dict[str, str],
) -> int | None:
    """Create a `source_documents` row for a chat attachment, or return the
    existing row id when the same content was already recorded for this
    chat message (chat_message_id + content_sha256)."""
    raw_b64 = (attachment.get("data") or "").strip()
    if not raw_b64:
        return None

    mime_type = (attachment.get("media_type") or "").strip() or None
    kind = _attachment_kind(mime_type or "")
    if kind is None:
        return None

    try:
        payload = base64.b64decode(raw_b64, validate=True)
    except (ValueError, binascii.Error):
        logger.warning(
            "Skipping source document for chat_message_id=%s: invalid base64",
            chat_message_id,
        )
        return None

    content_sha256 = hashlib.sha256(payload).hexdigest()
    existing = fetch_one(
        db,
        """
        SELECT id FROM source_documents
        WHERE chat_message_id = ? AND content_sha256 = ?
        """,
        (chat_message_id, content_sha256),
    )
    if existing is not None:
        return int(existing["id"])

    original_filename = (attachment.get("name") or "").strip() or None
    size_bytes = len(payload)

    try:
        return execute(
            db,
            """
            INSERT INTO source_documents (
                kind,
                chat_message_id,
                filename,
                mime_type,
                content_sha256,
                storage_type,
                size_bytes,
                created_at
            )
            VALUES (?, ?, ?, ?, ?, 'chat_attachment', ?, datetime('now'))
            """,
            (
                kind,
                chat_message_id,
                original_filename,
                mime_type,
                content_sha256,
                size_bytes,
            ),
        )
    except Exception:
        # Race: another writer may have inserted the same message + sha256.
        dup = fetch_one(
            db,
            """
            SELECT id FROM source_documents
            WHERE chat_message_id = ? AND content_sha256 = ?
            """,
            (chat_message_id, content_sha256),
        )
        if dup is not None:
            return int(dup["id"])
        logger.exception(
            "Failed to record source document for chat_message_id=%s",
            chat_message_id,
        )
        return None
