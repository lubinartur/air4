"""Finance Vertical — invoice list and confirm → obligation."""

from __future__ import annotations

from typing import Any

from database import fetch_all, fetch_one


class InvoiceNotFoundError(Exception):
    """No invoice row for the given id."""


class InvoiceConfirmValidationError(Exception):
    """Invoice cannot be confirmed with the current field values."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


def list_invoices(db: Any) -> list[dict[str, Any]]:
    """Return invoices newest-first, joined with source + obligation info."""
    return fetch_all(
        db,
        """
        SELECT
            i.id,
            i.issuer,
            i.invoice_number,
            i.amount,
            i.currency,
            i.issue_date,
            i.due_date,
            i.status,
            i.confidence,
            i.source_document_id,
            i.obligation_id,
            i.created_at,
            sd.filename AS source_filename,
            o.name AS obligation_name,
            o.currency AS obligation_currency
        FROM invoices i
        LEFT JOIN source_documents sd ON sd.id = i.source_document_id
        LEFT JOIN obligations o ON o.id = i.obligation_id
        ORDER BY datetime(i.created_at) DESC, i.id DESC
        """,
    )


def get_invoice_with_links(db: Any, invoice_id: int) -> dict[str, Any] | None:
    return fetch_one(
        db,
        """
        SELECT
            i.id,
            i.issuer,
            i.invoice_number,
            i.amount,
            i.currency,
            i.issue_date,
            i.due_date,
            i.status,
            i.confidence,
            i.source_document_id,
            i.obligation_id,
            i.created_at,
            sd.filename AS source_filename,
            o.name AS obligation_name,
            o.currency AS obligation_currency
        FROM invoices i
        LEFT JOIN source_documents sd ON sd.id = i.source_document_id
        LEFT JOIN obligations o ON o.id = i.obligation_id
        WHERE i.id = ?
        """,
        (invoice_id,),
    )


def _normalize_currency(raw: Any) -> str:
    code = str(raw or "").strip().upper()
    if len(code) != 3 or not code.isalpha():
        raise InvoiceConfirmValidationError(
            "Cannot confirm: currency must be a 3-letter code "
            "(invoice currency is preserved; no silent conversion)."
        )
    return code


def _validate_for_obligation(
    invoice: dict[str, Any],
) -> tuple[str, float, str, str]:
    issuer = str(invoice.get("issuer") or "").strip()
    if not issuer:
        raise InvoiceConfirmValidationError(
            "Cannot confirm: issuer is required to create an obligation."
        )

    amount_raw = invoice.get("amount")
    try:
        amount = float(amount_raw) if amount_raw is not None else None
    except (TypeError, ValueError):
        amount = None
    if amount is None or amount <= 0:
        raise InvoiceConfirmValidationError(
            "Cannot confirm: a positive amount is required to create an obligation."
        )

    due_date = str(invoice.get("due_date") or "").strip()
    if not due_date:
        raise InvoiceConfirmValidationError(
            "Cannot confirm: due_date is required to create an obligation."
        )

    # Invoice rows default to EUR in schema; treat empty/null as EUR only when
    # the column is unset. Explicit non-EUR codes are preserved as-is.
    currency_raw = invoice.get("currency")
    if currency_raw is None or str(currency_raw).strip() == "":
        currency = "EUR"
    else:
        currency = _normalize_currency(currency_raw)

    return issuer[:200], amount, due_date, currency


def confirm_invoice(
    db: Any,
    invoice_id: int,
    *,
    _fail_after_obligation: bool = False,
) -> dict[str, Any]:
    """Confirm a draft invoice and create a linked obligation atomically.

    Idempotent: a confirmed invoice with obligation_id returns as-is.
    On validation failure the invoice stays draft (no writes).
    """
    invoice = get_invoice_with_links(db, invoice_id)
    if invoice is None:
        raise InvoiceNotFoundError(f"Invoice {invoice_id} not found")

    status = str(invoice.get("status") or "draft")
    existing_obl = invoice.get("obligation_id")
    if status == "confirmed" and existing_obl is not None:
        return invoice

    if status not in {"draft", "confirmed"}:
        raise InvoiceConfirmValidationError(
            f"Cannot confirm: invoice status is '{status}'."
        )

    issuer, amount, due_date, currency = _validate_for_obligation(invoice)
    source = f"invoice:{invoice_id}"

    try:
        cur = db.execute(
            """
            INSERT INTO obligations (
                name, total_amount, remaining_amount, monthly_payment,
                interest_rate, due_date, currency, category, is_active, source,
                created_at, updated_at
            )
            VALUES (?, ?, ?, NULL, NULL, ?, ?, 'invoice', 1, ?,
                    datetime('now'), datetime('now'))
            """,
            (issuer, amount, amount, due_date, currency, source),
        )
        obligation_id = int(cur.lastrowid)
        if _fail_after_obligation:
            raise RuntimeError("simulated failure after obligation insert")
        db.execute(
            """
            UPDATE invoices
               SET status = 'confirmed',
                   obligation_id = ?,
                   updated_at = datetime('now')
             WHERE id = ?
            """,
            (obligation_id, invoice_id),
        )
        db.commit()
    except Exception:
        db.rollback()
        raise

    result = get_invoice_with_links(db, invoice_id)
    if result is None:
        raise RuntimeError(f"Invoice {invoice_id} missing after confirm")
    return result
