"""Finance Vertical — Gmail attachment discovery (read-only).

Searches recent Gmail messages for PDF attachment candidates. Does not
download bodies, persist SourceDocuments, or create invoices.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from email.utils import parseaddr
from typing import Any

from services.gmail_client import (
    DEFAULT_MAX_RESULTS,
    DEFAULT_SEARCH_QUERY,
    GmailClient,
    get_default_gmail_client,
)

logger = logging.getLogger("finance_gmail")

_PDF_MIME = "application/pdf"
_INLINE_IMAGE_PREFIXES = ("image/",)
_SIGNATURE_NAME_HINTS = (
    "signature",
    "logo",
    "spacer",
    "pixel",
    "untitled",
    "image001",
    "image002",
    "image003",
)


def external_source_key(gmail_message_id: str, attachment_id: str) -> str:
    """Stable external identity for a Gmail attachment.

    Future persistence can store this on ``source_documents`` (or a
    dedicated external_sources table) for import dedup. Not written yet.
    """
    return f"gmail:{gmail_message_id}:{attachment_id}"


def is_already_imported(external_key: str) -> bool:
    """Dedup preview stub.

    Schema has no external Gmail identity column yet, so this always
    returns False. Replace with a DB lookup once SourceDocument
    persistence for Gmail lands — do not invent unsafe persistence here.
    """
    _ = external_key
    return False


def _header_map(payload: dict[str, Any]) -> dict[str, str]:
    headers = payload.get("headers") or []
    out: dict[str, str] = {}
    if not isinstance(headers, list):
        return out
    for item in headers:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip().lower()
        if not name:
            continue
        out[name] = str(item.get("value") or "")
    return out


def _walk_parts(node: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not isinstance(node, dict):
        return []
    parts = node.get("parts")
    if isinstance(parts, list) and parts:
        collected: list[dict[str, Any]] = []
        for part in parts:
            if isinstance(part, dict):
                collected.extend(_walk_parts(part))
        return collected
    return [node]


def _part_disposition(part: dict[str, Any]) -> str:
    headers = _header_map(part)
    raw = headers.get("content-disposition") or ""
    return raw.split(";", 1)[0].strip().lower()


def _is_pdf_candidate(filename: str, mime_type: str) -> bool:
    name = filename.lower()
    mime = mime_type.lower()
    if mime == _PDF_MIME:
        return True
    if name.endswith(".pdf"):
        return True
    return False


def _looks_like_inline_noise(filename: str, mime_type: str, disposition: str) -> bool:
    mime = mime_type.lower()
    if mime.startswith(_INLINE_IMAGE_PREFIXES):
        return True
    if disposition == "inline" and not filename.lower().endswith(".pdf"):
        return True
    lower = filename.lower()
    return any(hint in lower for hint in _SIGNATURE_NAME_HINTS)


def _format_received_at(internal_date_ms: Any) -> str | None:
    try:
        ms = int(internal_date_ms)
    except (TypeError, ValueError):
        return None
    if ms <= 0:
        return None
    dt = datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc)
    return dt.isoformat().replace("+00:00", "Z")


def extract_pdf_attachments_from_message(
    message: dict[str, Any],
) -> list[dict[str, Any]]:
    """Parse one Gmail message into PDF attachment candidate dicts."""
    message_id = str(message.get("id") or "").strip()
    if not message_id:
        return []

    thread_id = str(message.get("threadId") or "").strip() or None
    payload = message.get("payload")
    if not isinstance(payload, dict):
        payload = {}
    headers = _header_map(payload)
    subject = (headers.get("subject") or "").strip() or "(no subject)"
    sender_raw = headers.get("from") or ""
    _name, sender_email = parseaddr(sender_raw)
    sender = (sender_email or sender_raw).strip() or "(unknown sender)"
    received_at = _format_received_at(message.get("internalDate"))

    candidates: list[dict[str, Any]] = []
    for part in _walk_parts(payload):
        filename = str(part.get("filename") or "").strip()
        mime_type = str(part.get("mimeType") or "").strip() or "application/octet-stream"
        body = part.get("body") if isinstance(part.get("body"), dict) else {}
        attachment_id = str(body.get("attachmentId") or "").strip()
        try:
            size_bytes = int(body.get("size") or 0)
        except (TypeError, ValueError):
            size_bytes = 0

        if not filename or not attachment_id:
            continue
        if not _is_pdf_candidate(filename, mime_type):
            continue
        disposition = _part_disposition(part)
        if _looks_like_inline_noise(filename, mime_type, disposition):
            continue

        key = external_source_key(message_id, attachment_id)
        candidates.append(
            {
                "gmail_message_id": message_id,
                "gmail_thread_id": thread_id,
                "subject": subject,
                "sender": sender,
                "received_at": received_at,
                "attachment_id": attachment_id,
                "filename": filename,
                "mime_type": mime_type if mime_type else _PDF_MIME,
                "size_bytes": size_bytes if size_bytes > 0 else None,
                "external_source_key": key,
                "already_imported": is_already_imported(key),
            }
        )
    return candidates


def discover_gmail_pdf_candidates(
    client: GmailClient | None = None,
    *,
    query: str = DEFAULT_SEARCH_QUERY,
    max_results: int = DEFAULT_MAX_RESULTS,
) -> list[dict[str, Any]]:
    """Search Gmail and return PDF attachment candidates for review."""
    gmail = client or get_default_gmail_client()
    refs = gmail.list_message_refs(query, max_results=max_results)
    if not refs:
        return []

    out: list[dict[str, Any]] = []
    for ref in refs:
        mid = str(ref.get("id") or "").strip()
        if not mid:
            continue
        try:
            message = gmail.get_message(mid)
        except Exception:
            logger.exception("Skipping Gmail message %s after fetch failure", mid)
            continue
        out.extend(extract_pdf_attachments_from_message(message))
    return out
