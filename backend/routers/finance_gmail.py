"""Finance Vertical — Gmail discovery API (read-only candidates)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from schemas import (
    FinanceGmailCandidateOut,
    FinanceGmailCandidatesListOut,
)
from services.finance_gmail import discover_gmail_pdf_candidates
from services.gmail_client import GmailApiError, GmailAuthError

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
    )


@router.get(
    "/finance/gmail/candidates",
    response_model=FinanceGmailCandidatesListOut,
)
def get_finance_gmail_candidates() -> FinanceGmailCandidatesListOut:
    try:
        rows = discover_gmail_pdf_candidates()
    except GmailAuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except GmailApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return FinanceGmailCandidatesListOut(
        candidates=[_row_to_candidate(r) for r in rows]
    )
