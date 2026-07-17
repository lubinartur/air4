"""Tests for GET /api/finance/invoices (Finance Inbox)."""

from __future__ import annotations

import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from database import apply_schema  # noqa: E402
from routers.finance_invoices import get_finance_invoices  # noqa: E402
from services.finance_invoices import list_invoices  # noqa: E402


def _temp_db_path() -> Path:
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    path = Path(tmp.name)
    tmp.close()
    return path


def _connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def _seed_invoice(
    conn: sqlite3.Connection,
    *,
    issuer: str,
    filename: str | None,
    created_at: str,
    amount: float = 10.0,
) -> None:
    source_id = None
    if filename is not None:
        cur = conn.execute(
            """
            INSERT INTO source_documents
                (kind, storage_type, filename, mime_type, content_sha256)
            VALUES ('pdf', 'chat_attachment', ?, 'application/pdf', ?)
            """,
            (filename, filename + "-sha"),
        )
        source_id = int(cur.lastrowid)
    conn.execute(
        """
        INSERT INTO invoices (
            source_document_id, issuer, invoice_number, amount, currency,
            issue_date, due_date, status, confidence, created_at, updated_at
        )
        VALUES (?, ?, 'N-1', ?, 'EUR', '2026-07-01', '2026-07-31',
                'draft', 0.8, ?, ?)
        """,
        (source_id, issuer, amount, created_at, created_at),
    )
    conn.commit()


class TestListInvoicesService(unittest.TestCase):
    def setUp(self) -> None:
        self.path = _temp_db_path()
        self.conn = _connect(self.path)
        apply_schema(self.conn)
        self.conn.commit()

    def tearDown(self) -> None:
        self.conn.close()
        self.path.unlink(missing_ok=True)

    def test_empty_database_returns_empty_list(self) -> None:
        self.assertEqual(list_invoices(self.conn), [])

    def test_newest_first_and_source_filename(self) -> None:
        _seed_invoice(
            self.conn,
            issuer="Old Co",
            filename="old.pdf",
            created_at="2026-07-01 10:00:00",
        )
        _seed_invoice(
            self.conn,
            issuer="New Co",
            filename="new.pdf",
            created_at="2026-07-10 12:00:00",
        )
        rows = list_invoices(self.conn)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["issuer"], "New Co")
        self.assertEqual(rows[0]["source_filename"], "new.pdf")
        self.assertEqual(rows[1]["issuer"], "Old Co")
        self.assertEqual(rows[1]["source_filename"], "old.pdf")


class TestFinanceInvoicesEndpoint(unittest.TestCase):
    def setUp(self) -> None:
        self.path = _temp_db_path()
        self.conn = _connect(self.path)
        apply_schema(self.conn)
        self.conn.commit()

    def tearDown(self) -> None:
        self.conn.close()
        self.path.unlink(missing_ok=True)

    def test_endpoint_returns_invoices_newest_first(self) -> None:
        _seed_invoice(
            self.conn,
            issuer="Alpha",
            filename="a.pdf",
            created_at="2026-06-01 00:00:00",
        )
        _seed_invoice(
            self.conn,
            issuer="Beta",
            filename="b.pdf",
            created_at="2026-07-15 00:00:00",
        )

        from contextlib import contextmanager

        @contextmanager
        def _fake_get_db():
            yield self.conn

        with patch("routers.finance_invoices.get_db", _fake_get_db):
            out = get_finance_invoices()

        self.assertEqual(len(out.invoices), 2)
        self.assertEqual(out.invoices[0].issuer, "Beta")
        self.assertEqual(out.invoices[0].source_filename, "b.pdf")
        self.assertEqual(out.invoices[1].issuer, "Alpha")

    def test_endpoint_empty_database_returns_empty(self) -> None:
        from contextlib import contextmanager

        @contextmanager
        def _fake_get_db():
            yield self.conn

        with patch("routers.finance_invoices.get_db", _fake_get_db):
            out = get_finance_invoices()
        self.assertEqual(out.invoices, [])


if __name__ == "__main__":
    unittest.main()
