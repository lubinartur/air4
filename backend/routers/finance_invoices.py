"""Finance Vertical — invoice inbox + confirm API."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from database import get_db
from schemas import FinanceInvoiceOut, FinanceInvoicesListOut
from services.finance_invoices import (
    InvoiceConfirmValidationError,
    InvoiceNotFoundError,
    confirm_invoice,
    list_invoices,
)

router = APIRouter()


def _row_to_invoice(row: dict[str, Any]) -> FinanceInvoiceOut:
    filename = row.get("source_filename")
    obligation_name = row.get("obligation_name")
    obligation_id = row.get("obligation_id")
    obligation_currency = row.get("obligation_currency")
    return FinanceInvoiceOut(
        id=int(row["id"]),
        issuer=row.get("issuer"),
        invoice_number=row.get("invoice_number"),
        amount=row.get("amount"),
        currency=str(row.get("currency") or "EUR"),
        issue_date=row.get("issue_date"),
        due_date=row.get("due_date"),
        status=str(row.get("status") or "draft"),
        confidence=row.get("confidence"),
        source_document_id=row.get("source_document_id"),
        source_filename=(str(filename) if filename else None),
        obligation_id=(int(obligation_id) if obligation_id is not None else None),
        obligation_name=(str(obligation_name) if obligation_name else None),
        obligation_currency=(
            str(obligation_currency) if obligation_currency else None
        ),
    )


@router.get("/finance/invoices", response_model=FinanceInvoicesListOut)
def get_finance_invoices() -> FinanceInvoicesListOut:
    with get_db() as conn:
        rows = list_invoices(conn)
    return FinanceInvoicesListOut(invoices=[_row_to_invoice(r) for r in rows])


@router.post(
    "/finance/invoices/{invoice_id}/confirm",
    response_model=FinanceInvoiceOut,
)
def confirm_finance_invoice(invoice_id: int) -> FinanceInvoiceOut:
    try:
        with get_db() as conn:
            row = confirm_invoice(conn, invoice_id)
    except InvoiceNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except InvoiceConfirmValidationError as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc
    return _row_to_invoice(row)
