"""Finance Vertical — invoice extraction from chat SourceDocuments.

After a PDF/image SourceDocument is recorded, a best-effort Haiku call
extracts structured invoice fields. On success one `invoices` row is
created with status=draft, linked by `source_document_id`. Failures never
affect chat success.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from database import execute, fetch_one
from services.llm_client import parse_json_object
from services.llm_client_shared import call_claude_content

logger = logging.getLogger("invoice_extractor")

_PDF_MIME = "application/pdf"
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

_EXTRACTION_PROMPT = (
    "Extract invoice fields from the attached document or image.\n"
    "Return ONLY valid JSON (no markdown):\n"
    "{\n"
    '  "found": true,\n'
    '  "issuer": "company or person name",\n'
    '  "invoice_number": "string or null",\n'
    '  "amount": 123.45,\n'
    '  "currency": "EUR",\n'
    '  "issue_date": "YYYY-MM-DD or null",\n'
    '  "due_date": "YYYY-MM-DD or null",\n'
    '  "confidence": 0.0\n'
    "}\n"
    "Rules:\n"
    "- found=false when this is not an invoice/bill or required fields "
    "cannot be read\n"
    "- issuer and amount are required when found=true\n"
    "- amount is a positive number (major currency units)\n"
    "- currency is a 3-letter code; default EUR when unclear\n"
    "- confidence is 0..1 for the overall extraction\n"
)


def _is_extractable_attachment(attachment: dict[str, str] | None) -> bool:
    if not attachment:
        return False
    raw = (attachment.get("data") or "").strip()
    if not raw:
        return False
    mime = (attachment.get("media_type") or "").strip().lower()
    return mime == _PDF_MIME or mime.startswith("image/")


def _attachment_content_block(attachment: dict[str, str]) -> dict[str, Any]:
    media_type = attachment["media_type"]
    source = {
        "type": "base64",
        "media_type": media_type,
        "data": attachment["data"],
    }
    if media_type == _PDF_MIME:
        return {"type": "document", "source": source}
    return {"type": "image", "source": source}


def _parse_amount(raw: Any) -> float | None:
    if isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)):
        value = float(raw)
        return value if value > 0 else None
    if isinstance(raw, str):
        cleaned = raw.strip().replace(" ", "").replace(",", ".")
        try:
            value = float(cleaned)
        except ValueError:
            return None
        return value if value > 0 else None
    return None


def _parse_date(raw: Any) -> str | None:
    if raw is None:
        return None
    text = str(raw).strip()
    if not text or text.lower() in {"null", "none", "n/a"}:
        return None
    return text if _DATE_RE.match(text) else None


def _parse_confidence(raw: Any) -> float | None:
    if isinstance(raw, bool) or raw is None:
        return None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    if value < 0 or value > 1:
        return None
    return value


def normalize_extracted_invoice(raw: dict[str, Any] | None) -> dict[str, Any] | None:
    """Validate extraction JSON. Returns field dict or None when incomplete."""
    if not isinstance(raw, dict):
        return None
    if raw.get("found") is False:
        return None

    issuer = str(raw.get("issuer") or "").strip() or None
    amount = _parse_amount(raw.get("amount"))
    if not issuer or amount is None:
        return None

    currency = str(raw.get("currency") or "EUR").strip().upper() or "EUR"
    if len(currency) > 8:
        currency = currency[:8]

    invoice_number = str(raw.get("invoice_number") or "").strip() or None
    if invoice_number and invoice_number.lower() in {"null", "none"}:
        invoice_number = None

    return {
        "issuer": issuer[:500],
        "invoice_number": (invoice_number[:200] if invoice_number else None),
        "amount": amount,
        "currency": currency,
        "issue_date": _parse_date(raw.get("issue_date")),
        "due_date": _parse_date(raw.get("due_date")),
        "confidence": _parse_confidence(raw.get("confidence")),
        "status": "draft",
    }


def find_invoice_for_source(db: Any, source_document_id: int) -> dict[str, Any] | None:
    return fetch_one(
        db,
        "SELECT * FROM invoices WHERE source_document_id = ? LIMIT 1",
        (source_document_id,),
    )


def create_invoice_from_extraction(
    db: Any,
    source_document_id: int,
    fields: dict[str, Any],
) -> int | None:
    """Insert one draft invoice for a SourceDocument, or return existing id."""
    existing = find_invoice_for_source(db, source_document_id)
    if existing is not None:
        return int(existing["id"])

    try:
        return execute(
            db,
            """
            INSERT INTO invoices (
                source_document_id,
                issuer,
                invoice_number,
                amount,
                currency,
                due_date,
                issue_date,
                status,
                confidence,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, datetime('now'), datetime('now'))
            """,
            (
                source_document_id,
                fields.get("issuer"),
                fields.get("invoice_number"),
                fields.get("amount"),
                fields.get("currency") or "EUR",
                fields.get("due_date"),
                fields.get("issue_date"),
                fields.get("confidence"),
            ),
        )
    except Exception:
        dup = find_invoice_for_source(db, source_document_id)
        if dup is not None:
            return int(dup["id"])
        logger.exception(
            "Failed to create invoice for source_document_id=%s",
            source_document_id,
        )
        return None


async def extract_invoice_fields(
    attachment: dict[str, str],
    api_key: str,
) -> dict[str, Any] | None:
    """Ask Claude for structured invoice fields from a PDF/image attachment."""
    if not _is_extractable_attachment(attachment):
        return None
    if not (api_key or "").strip():
        return None

    content: list[dict[str, Any]] = [
        _attachment_content_block(attachment),
        {"type": "text", "text": _EXTRACTION_PROMPT},
    ]
    try:
        text = await call_claude_content(
            content,
            api_key=api_key,
            max_tokens=512,
            temperature=0,
        )
    except Exception:
        logger.exception("Invoice LLM extraction failed")
        return None

    return normalize_extracted_invoice(parse_json_object(text))


async def extract_and_create_invoice(
    db: Any,
    *,
    source_document_id: int,
    attachment: dict[str, str] | None,
    api_key: str,
) -> int | None:
    """Best-effort: extract invoice fields and create one Invoice row."""
    if not source_document_id:
        return None

    existing = find_invoice_for_source(db, source_document_id)
    if existing is not None:
        return int(existing["id"])

    if not _is_extractable_attachment(attachment):
        return None

    assert attachment is not None
    fields = await extract_invoice_fields(attachment, api_key)
    if fields is None:
        return None

    return create_invoice_from_extraction(db, source_document_id, fields)
