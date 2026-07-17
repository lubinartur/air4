"""Tests for invoice confirm → obligation (Finance Vertical)."""

from __future__ import annotations

import sqlite3
import sys
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from database import apply_schema  # noqa: E402
from routers.finance_invoices import confirm_finance_invoice  # noqa: E402
from services.finance_invoices import (  # noqa: E402
    InvoiceConfirmValidationError,
    InvoiceNotFoundError,
    confirm_invoice,
)


def _temp_db_path() -> Path:
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    path = Path(tmp.name)
    tmp.close()
    return path


def _connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _insert_draft(
    conn: sqlite3.Connection,
    *,
    issuer: str = "ACME OÜ",
    amount: float | None = 199.5,
    due_date: str | None = "2026-07-31",
    currency: str = "EUR",
) -> int:
    cur = conn.execute(
        """
        INSERT INTO invoices (
            issuer, invoice_number, amount, currency, due_date, issue_date,
            status, confidence, created_at, updated_at
        )
        VALUES (?, 'INV-1', ?, ?, ?, '2026-07-01',
                'draft', 0.9, datetime('now'), datetime('now'))
        """,
        (issuer, amount, currency, due_date),
    )
    conn.commit()
    return int(cur.lastrowid)


class TestConfirmInvoiceService(unittest.TestCase):
    def setUp(self) -> None:
        self.path = _temp_db_path()
        self.conn = _connect(self.path)
        apply_schema(self.conn)
        self.conn.commit()

    def tearDown(self) -> None:
        self.conn.close()
        self.path.unlink(missing_ok=True)

    def test_draft_confirms_and_creates_obligation(self) -> None:
        invoice_id = _insert_draft(self.conn)
        row = confirm_invoice(self.conn, invoice_id)
        self.assertEqual(row["status"], "confirmed")
        self.assertIsNotNone(row["obligation_id"])
        self.assertEqual(row["obligation_name"], "ACME OÜ")

        obl = self.conn.execute(
            "SELECT * FROM obligations WHERE id = ?",
            (row["obligation_id"],),
        ).fetchone()
        self.assertIsNotNone(obl)
        self.assertEqual(obl["name"], "ACME OÜ")
        self.assertEqual(obl["total_amount"], 199.5)
        self.assertEqual(obl["remaining_amount"], 199.5)
        self.assertEqual(obl["due_date"], "2026-07-31")
        self.assertEqual(obl["category"], "invoice")
        self.assertEqual(obl["currency"], "EUR")
        self.assertEqual(obl["source"], f"invoice:{invoice_id}")
        self.assertEqual(row["obligation_currency"], "EUR")

    def test_eur_invoice_confirms_with_eur_obligation(self) -> None:
        invoice_id = _insert_draft(self.conn, currency="EUR")
        row = confirm_invoice(self.conn, invoice_id)
        self.assertEqual(row["status"], "confirmed")
        self.assertEqual(row["obligation_currency"], "EUR")
        obl = self.conn.execute(
            "SELECT currency FROM obligations WHERE id = ?",
            (row["obligation_id"],),
        ).fetchone()
        self.assertEqual(obl["currency"], "EUR")

    def test_usd_invoice_preserves_usd_on_obligation(self) -> None:
        invoice_id = _insert_draft(self.conn, currency="USD", amount=50.0)
        row = confirm_invoice(self.conn, invoice_id)
        self.assertEqual(row["status"], "confirmed")
        self.assertEqual(row["currency"], "USD")
        self.assertEqual(row["obligation_currency"], "USD")
        obl = self.conn.execute(
            "SELECT currency, total_amount FROM obligations WHERE id = ?",
            (row["obligation_id"],),
        ).fetchone()
        self.assertEqual(obl["currency"], "USD")
        self.assertEqual(obl["total_amount"], 50.0)

    def test_invalid_currency_leaves_draft_and_no_obligation(self) -> None:
        invoice_id = _insert_draft(self.conn, currency="US")
        with self.assertRaises(InvoiceConfirmValidationError):
            confirm_invoice(self.conn, invoice_id)
        row = dict(
            self.conn.execute(
                "SELECT status, obligation_id FROM invoices WHERE id = ?",
                (invoice_id,),
            ).fetchone()
        )
        self.assertEqual(row["status"], "draft")
        self.assertIsNone(row["obligation_id"])
        self.assertEqual(
            int(self.conn.execute("SELECT COUNT(*) FROM obligations").fetchone()[0]),
            0,
        )

    def test_repeated_confirm_creates_no_duplicate(self) -> None:
        invoice_id = _insert_draft(self.conn)
        first = confirm_invoice(self.conn, invoice_id)
        second = confirm_invoice(self.conn, invoice_id)
        self.assertEqual(first["obligation_id"], second["obligation_id"])
        count = int(
            self.conn.execute("SELECT COUNT(*) FROM obligations").fetchone()[0]
        )
        self.assertEqual(count, 1)

    def test_missing_due_date_fails_safely(self) -> None:
        invoice_id = _insert_draft(self.conn, due_date=None)
        with self.assertRaises(InvoiceConfirmValidationError):
            confirm_invoice(self.conn, invoice_id)
        row = dict(
            self.conn.execute(
                "SELECT status, obligation_id FROM invoices WHERE id = ?",
                (invoice_id,),
            ).fetchone()
        )
        self.assertEqual(row["status"], "draft")
        self.assertIsNone(row["obligation_id"])
        self.assertEqual(
            int(self.conn.execute("SELECT COUNT(*) FROM obligations").fetchone()[0]),
            0,
        )

    def test_invalid_amount_fails_safely(self) -> None:
        invoice_id = _insert_draft(self.conn, amount=0)
        with self.assertRaises(InvoiceConfirmValidationError):
            confirm_invoice(self.conn, invoice_id)
        row = dict(
            self.conn.execute(
                "SELECT status FROM invoices WHERE id = ?", (invoice_id,)
            ).fetchone()
        )
        self.assertEqual(row["status"], "draft")

    def test_nonexistent_invoice_raises(self) -> None:
        with self.assertRaises(InvoiceNotFoundError):
            confirm_invoice(self.conn, 99999)

    def test_transaction_rollback_preserves_draft_on_failure(self) -> None:
        invoice_id = _insert_draft(self.conn)
        with self.assertRaises(RuntimeError):
            confirm_invoice(
                self.conn, invoice_id, _fail_after_obligation=True
            )

        row = dict(
            self.conn.execute(
                "SELECT status, obligation_id FROM invoices WHERE id = ?",
                (invoice_id,),
            ).fetchone()
        )
        self.assertEqual(row["status"], "draft")
        self.assertIsNone(row["obligation_id"])
        self.assertEqual(
            int(self.conn.execute("SELECT COUNT(*) FROM obligations").fetchone()[0]),
            0,
        )


class TestConfirmInvoiceEndpoint(unittest.TestCase):
    def setUp(self) -> None:
        self.path = _temp_db_path()
        self.conn = _connect(self.path)
        apply_schema(self.conn)
        self.conn.commit()

    def tearDown(self) -> None:
        self.conn.close()
        self.path.unlink(missing_ok=True)

    def test_endpoint_404(self) -> None:
        from fastapi import HTTPException

        @contextmanager
        def _fake_get_db():
            yield self.conn

        with patch("routers.finance_invoices.get_db", _fake_get_db):
            with self.assertRaises(HTTPException) as ctx:
                confirm_finance_invoice(40404)
        self.assertEqual(ctx.exception.status_code, 404)

    def test_endpoint_confirm_ok(self) -> None:
        invoice_id = _insert_draft(self.conn)

        @contextmanager
        def _fake_get_db():
            yield self.conn

        with patch("routers.finance_invoices.get_db", _fake_get_db):
            out = confirm_finance_invoice(invoice_id)
        self.assertEqual(out.status, "confirmed")
        self.assertIsNotNone(out.obligation_id)
        self.assertEqual(out.obligation_name, "ACME OÜ")


if __name__ == "__main__":
    unittest.main()
