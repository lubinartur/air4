"""Finance Vertical — Gmail discovery + single-item import API."""

from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter, HTTPException

from database import get_db
from schemas import (
    FinanceGmailCandidateOut,
    FinanceGmailCandidatesListOut,
    FinanceGmailImportIn,
    FinanceGmailImportOut,
)
from services.finance_gmail import (
    GmailAttachmentMissingError,
    GmailInvoiceExtractionError,
    GmailNotPdfError,
    discover_gmail_pdf_candidates,
    import_gmail_pdf_attachment,
)
from services.gmail_client import (
    GmailApiError,
    GmailAuthError,
    GmailNotFoundError,
)

router = APIRouter()


def _row_to_candidate(row: dict[str, Any]) -> FinanceGmailCandidateOut:
    return FinanceGmailCandidateOut(
        gmail_message_id=str(row["gmail_message_id"]),
        gmail_thread_id=row.get("gmail_thread_id"),
        subject=str(row.get("subject") or ""),
        sender=str(row.get("sender") or ""),
        received_at=row.get("received_at"),
        attachment_id=str(row["attachment_id"]),
        filename=str(row["filename"]),
        mime_type=str(row.get("mime_type") or "application/pdf"),
        size_bytes=row.get("size_bytes"),
        already_imported=bool(row.get("already_imported")),
        external_source_key=str(row.get("external_source_key") or ""),
        source_document_id=row.get("source_document_id"),
        invoice_id=row.get("invoice_id"),
        invoice_status=row.get("invoice_status"),
    )


@router.get(
    "/finance/gmail/candidates",
    response_model=FinanceGmailCandidatesListOut,
)
def get_finance_gmail_candidates() -> FinanceGmailCandidatesListOut:
    try:
        with get_db() as conn:
            rows = discover_gmail_pdf_candidates(db=conn)
    except GmailAuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except GmailApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return FinanceGmailCandidatesListOut(
        candidates=[_row_to_candidate(r) for r in rows]
    )


@router.post(
    "/finance/gmail/import",
    response_model=FinanceGmailImportOut,
)
async def post_finance_gmail_import(
    payload: FinanceGmailImportIn,
) -> FinanceGmailImportOut:
    api_key = os.getenv("ANTHROPIC_API_KEY", "") or ""
    try:
        with get_db() as conn:
            result = await import_gmail_pdf_attachment(
                conn,
                gmail_message_id=payload.gmail_message_id,
                attachment_id=payload.attachment_id,
                api_key=api_key,
            )
    except GmailAuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except GmailNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except GmailAttachmentMissingError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except GmailNotPdfError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except GmailInvoiceExtractionError as exc:
        return FinanceGmailImportOut(
            source_document_id=exc.source_document_id,
            invoice_id=None,
            invoice_status=None,
            already_imported=False,
            filename=None,
            external_source_key="",
            extraction_failed=True,
            detail=exc.message,
        )
    except GmailApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return FinanceGmailImportOut(
        source_document_id=int(result["source_document_id"]),
        invoice_id=result.get("invoice_id"),
        invoice_status=result.get("invoice_status"),
        already_imported=bool(result.get("already_imported")),
        filename=result.get("filename"),
        external_source_key=str(result.get("external_source_key") or ""),
        extraction_failed=False,
        detail=None,
    )
