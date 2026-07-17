"""Finance Vertical — Gmail PDF discovery + single-item import.

Discovery searches recent messages for PDF attachment candidates.
Import downloads one attachment, persists a SourceDocument, and runs
the shared invoice extractor used by chat uploads.
"""

from __future__ import annotations

import base64
import hashlib
import logging
import os
from datetime import datetime, timezone
from email.utils import parseaddr
from typing import Any

from database import execute, fetch_one
from services.gmail_client import (
    DEFAULT_MAX_RESULTS,
    DEFAULT_SEARCH_QUERY,
    GmailClient,
    GmailNotFoundError,
    get_default_gmail_client,
)
from services.invoice_extractor import (
    create_invoice_from_extraction,
    extract_invoice_fields,
    find_invoice_for_source,
)

logger = logging.getLogger("finance_gmail")

_PDF_MIME = "application/pdf"
_SOURCE_TYPE_GMAIL = "gmail"
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


class GmailAttachmentMissingError(Exception):
    """Requested attachment_id is not present on the Gmail message."""


class GmailNotPdfError(Exception):
    """Attachment exists but is not an importable PDF."""


class GmailInvoiceExtractionError(Exception):
    """SourceDocument was saved but invoice extraction produced no draft."""

    def __init__(self, message: str, *, source_document_id: int) -> None:
        super().__init__(message)
        self.message = message
        self.source_document_id = source_document_id


def external_source_key(gmail_message_id: str, attachment_id: str) -> str:
    """Stable external identity for a Gmail attachment."""
    return f"gmail:{gmail_message_id}:{attachment_id}"


def find_source_by_external_key(
    db: Any, key: str, *, source_type: str = _SOURCE_TYPE_GMAIL
) -> dict[str, Any] | None:
    return fetch_one(
        db,
        """
        SELECT *
        FROM source_documents
        WHERE source_type = ? AND external_source_key = ?
        LIMIT 1
        """,
        (source_type, key),
    )


def lookup_import_status(db: Any | None, key: str) -> dict[str, Any]:
    """Return already_imported + linked invoice preview for discovery."""
    if db is None:
        return {
            "already_imported": False,
            "source_document_id": None,
            "invoice_id": None,
            "invoice_status": None,
        }
    source = find_source_by_external_key(db, key)
    if source is None:
        return {
            "already_imported": False,
            "source_document_id": None,
            "invoice_id": None,
            "invoice_status": None,
        }
    source_id = int(source["id"])
    invoice = find_invoice_for_source(db, source_id)
    return {
        "already_imported": True,
        "source_document_id": source_id,
        "invoice_id": (int(invoice["id"]) if invoice else None),
        "invoice_status": (
            str(invoice["status"]) if invoice and invoice.get("status") else None
        ),
    }


def is_already_imported(db: Any | None, external_key: str) -> bool:
    return bool(lookup_import_status(db, external_key)["already_imported"])


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


def find_attachment_part(
    message: dict[str, Any], attachment_id: str
) -> dict[str, Any] | None:
    """Return filename/mime/size for an attachment id on a Gmail message."""
    want = (attachment_id or "").strip()
    if not want:
        return None
    payload = message.get("payload")
    if not isinstance(payload, dict):
        payload = {}
    for part in _walk_parts(payload):
        body = part.get("body") if isinstance(part.get("body"), dict) else {}
        aid = str(body.get("attachmentId") or "").strip()
        if aid != want:
            continue
        filename = str(part.get("filename") or "").strip()
        mime_type = (
            str(part.get("mimeType") or "").strip() or "application/octet-stream"
        )
        try:
            size_bytes = int(body.get("size") or 0)
        except (TypeError, ValueError):
            size_bytes = 0
        return {
            "attachment_id": aid,
            "filename": filename,
            "mime_type": mime_type,
            "size_bytes": size_bytes if size_bytes > 0 else None,
            "disposition": _part_disposition(part),
        }
    return None


def extract_pdf_attachments_from_message(
    message: dict[str, Any],
    *,
    db: Any | None = None,
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
        status = lookup_import_status(db, key)
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
                "already_imported": status["already_imported"],
                "source_document_id": status["source_document_id"],
                "invoice_id": status["invoice_id"],
                "invoice_status": status["invoice_status"],
            }
        )
    return candidates


def discover_gmail_pdf_candidates(
    client: GmailClient | None = None,
    *,
    db: Any | None = None,
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
        out.extend(extract_pdf_attachments_from_message(message, db=db))
    return out


def _create_gmail_source_document(
    db: Any,
    *,
    filename: str,
    mime_type: str,
    size_bytes: int,
    content_sha256: str,
    external_key: str,
) -> int:
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
            source_type,
            external_source_key,
            created_at
        )
        VALUES ('pdf', NULL, ?, ?, ?, 'external_reference', ?, ?, ?, datetime('now'))
        """,
        (
            filename,
            mime_type,
            content_sha256,
            size_bytes,
            _SOURCE_TYPE_GMAIL,
            external_key,
        ),
    )


async def import_gmail_pdf_attachment(
    db: Any,
    *,
    gmail_message_id: str,
    attachment_id: str,
    client: GmailClient | None = None,
    api_key: str | None = None,
) -> dict[str, Any]:
    """Import one Gmail PDF into SourceDocument + draft Invoice.

    Uses authoritative Gmail metadata (not frontend-supplied fields).
    Idempotent on ``external_source_key``.
    """
    message_id = (gmail_message_id or "").strip()
    att_id = (attachment_id or "").strip()
    if not message_id:
        raise GmailAttachmentMissingError("gmail_message_id is required")
    if not att_id:
        raise GmailAttachmentMissingError("attachment_id is required")

    key = external_source_key(message_id, att_id)
    existing = find_source_by_external_key(db, key)
    if existing is not None:
        source_id = int(existing["id"])
        invoice = find_invoice_for_source(db, source_id)
        return {
            "source_document_id": source_id,
            "invoice_id": (int(invoice["id"]) if invoice else None),
            "invoice_status": (
                str(invoice["status"]) if invoice and invoice.get("status") else None
            ),
            "already_imported": True,
            "filename": existing.get("filename"),
            "external_source_key": key,
        }

    gmail = client or get_default_gmail_client()
    try:
        message = gmail.get_message(message_id)
    except GmailNotFoundError as exc:
        raise GmailNotFoundError("Gmail message not found.") from exc

    if str(message.get("id") or "").strip() != message_id:
        # Defensive: some stubs may omit id; keep going if body is usable.
        message = {**message, "id": message_id}

    meta = find_attachment_part(message, att_id)
    if meta is None:
        raise GmailAttachmentMissingError(
            "Attachment not found on the Gmail message."
        )
    filename = str(meta.get("filename") or "").strip()
    mime_type = str(meta.get("mime_type") or "").strip() or _PDF_MIME
    if not filename:
        raise GmailNotPdfError("Attachment has no filename.")
    if not _is_pdf_candidate(filename, mime_type):
        raise GmailNotPdfError("Only PDF attachments can be imported.")
    if _looks_like_inline_noise(
        filename, mime_type, str(meta.get("disposition") or "")
    ):
        raise GmailNotPdfError("Attachment looks like an inline image/signature.")

    raw_bytes = gmail.get_attachment(message_id, att_id)
    if not raw_bytes:
        raise GmailAttachmentMissingError("Gmail attachment download was empty.")

    content_sha256 = hashlib.sha256(raw_bytes).hexdigest()
    size_bytes = len(raw_bytes)
    mime_for_store = _PDF_MIME if filename.lower().endswith(".pdf") else mime_type

    try:
        source_id = _create_gmail_source_document(
            db,
            filename=filename[:500],
            mime_type=mime_for_store,
            size_bytes=size_bytes,
            content_sha256=content_sha256,
            external_key=key,
        )
    except Exception:
        # Race: another import may have inserted the same external key.
        raced = find_source_by_external_key(db, key)
        if raced is not None:
            source_id = int(raced["id"])
            invoice = find_invoice_for_source(db, source_id)
            return {
                "source_document_id": source_id,
                "invoice_id": (int(invoice["id"]) if invoice else None),
                "invoice_status": (
                    str(invoice["status"])
                    if invoice and invoice.get("status")
                    else None
                ),
                "already_imported": True,
                "filename": raced.get("filename"),
                "external_source_key": key,
            }
        raise

    key_api = (api_key if api_key is not None else os.getenv("ANTHROPIC_API_KEY", "")) or ""
    attachment = {
        "data": base64.b64encode(raw_bytes).decode("ascii"),
        "media_type": _PDF_MIME,
        "name": filename,
    }
    fields = await extract_invoice_fields(attachment, key_api)
    if fields is None:
        raise GmailInvoiceExtractionError(
            "Source document saved, but invoice extraction failed or found no invoice.",
            source_document_id=source_id,
        )

    invoice_id = create_invoice_from_extraction(db, source_id, fields)
    if invoice_id is None:
        raise GmailInvoiceExtractionError(
            "Source document saved, but invoice could not be created.",
            source_document_id=source_id,
        )

    invoice = find_invoice_for_source(db, source_id)
    return {
        "source_document_id": source_id,
        "invoice_id": invoice_id,
        "invoice_status": (
            str(invoice["status"]) if invoice and invoice.get("status") else "draft"
        ),
        "already_imported": False,
        "filename": filename,
        "external_source_key": key,
    }
