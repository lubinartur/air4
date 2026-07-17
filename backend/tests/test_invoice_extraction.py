"""Tests for SourceDocument → Invoice extraction (Finance Vertical).

Uses temporary SQLite. Never touches backend/data/air4.db.
LLM calls are mocked — no Anthropic network.
"""

from __future__ import annotations

import base64
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from database import apply_schema  # noqa: E402
from services.invoice_extractor import (  # noqa: E402
    create_invoice_from_extraction,
    extract_and_create_invoice,
    normalize_extracted_invoice,
)
from services.source_document import record_chat_attachment_source  # noqa: E402


def _temp_db_path() -> Path:
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    path = Path(tmp.name)
    tmp.close()
    return path


def _connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def _tiny_pdf_b64() -> str:
    return base64.b64encode(
        b"%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
    ).decode("ascii")


def _pdf_attachment(name: str = "invoice.pdf") -> dict[str, str]:
    return {
        "data": _tiny_pdf_b64(),
        "media_type": "application/pdf",
        "name": name,
    }


def _insert_user_message(conn: sqlite3.Connection, content: str = "счёт") -> int:
    cur = conn.execute(
        "INSERT INTO chat_messages (role, content) VALUES ('user', ?)",
        (content,),
    )
    conn.commit()
    return int(cur.lastrowid)


def _invoice_rows(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        """
        SELECT id, source_document_id, issuer, invoice_number, amount, currency,
               issue_date, due_date, status, confidence
        FROM invoices
        ORDER BY id
        """
    ).fetchall()
    return [dict(r) for r in rows]


_VALID_FIELDS = {
    "issuer": "ACME OÜ",
    "invoice_number": "INV-42",
    "amount": 199.5,
    "currency": "EUR",
    "issue_date": "2026-07-01",
    "due_date": "2026-07-31",
    "confidence": 0.91,
    "status": "draft",
}


class TestNormalizeExtractedInvoice(unittest.TestCase):
    def test_requires_issuer_and_amount(self) -> None:
        self.assertIsNone(normalize_extracted_invoice({"found": True, "amount": 10}))
        self.assertIsNone(
            normalize_extracted_invoice({"found": True, "issuer": "X"})
        )
        self.assertIsNone(normalize_extracted_invoice({"found": False, **_VALID_FIELDS}))

    def test_valid_payload(self) -> None:
        fields = normalize_extracted_invoice({"found": True, **_VALID_FIELDS})
        assert fields is not None
        self.assertEqual(fields["issuer"], "ACME OÜ")
        self.assertEqual(fields["amount"], 199.5)
        self.assertEqual(fields["status"], "draft")


class TestInvoiceFromSourceDocument(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.path = _temp_db_path()
        self.conn = _connect(self.path)
        apply_schema(self.conn)
        self.conn.commit()

    def tearDown(self) -> None:
        self.conn.close()
        self.path.unlink(missing_ok=True)

    def _source_for_pdf(self) -> int:
        msg_id = _insert_user_message(self.conn)
        source_id = record_chat_attachment_source(
            self.conn, msg_id, _pdf_attachment()
        )
        assert source_id is not None
        return source_id

    def test_valid_invoice_creates_one_invoice(self) -> None:
        source_id = self._source_for_pdf()
        invoice_id = create_invoice_from_extraction(
            self.conn, source_id, _VALID_FIELDS
        )
        self.assertIsNotNone(invoice_id)
        rows = _invoice_rows(self.conn)
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["source_document_id"], source_id)
        self.assertEqual(row["issuer"], "ACME OÜ")
        self.assertEqual(row["invoice_number"], "INV-42")
        self.assertEqual(row["amount"], 199.5)
        self.assertEqual(row["currency"], "EUR")
        self.assertEqual(row["issue_date"], "2026-07-01")
        self.assertEqual(row["due_date"], "2026-07-31")
        self.assertEqual(row["confidence"], 0.91)
        self.assertEqual(row["status"], "draft")

    def test_repeated_extraction_does_not_duplicate(self) -> None:
        source_id = self._source_for_pdf()
        first = create_invoice_from_extraction(self.conn, source_id, _VALID_FIELDS)
        second = create_invoice_from_extraction(
            self.conn,
            source_id,
            {**_VALID_FIELDS, "issuer": "Other", "amount": 1.0},
        )
        self.assertEqual(first, second)
        self.assertEqual(len(_invoice_rows(self.conn)), 1)
        self.assertEqual(_invoice_rows(self.conn)[0]["issuer"], "ACME OÜ")

    async def test_failed_extraction_creates_nothing(self) -> None:
        source_id = self._source_for_pdf()
        with patch(
            "services.invoice_extractor.call_claude_content",
            new=AsyncMock(return_value='{"found": false}'),
        ):
            result = await extract_and_create_invoice(
                self.conn,
                source_document_id=source_id,
                attachment=_pdf_attachment(),
                api_key="test-key",
            )
        self.assertIsNone(result)
        self.assertEqual(len(_invoice_rows(self.conn)), 0)

    async def test_text_attachment_creates_nothing(self) -> None:
        source_id = self._source_for_pdf()
        text_attachment = {
            "data": base64.b64encode(b"hello invoice").decode("ascii"),
            "media_type": "text/plain",
            "name": "note.txt",
        }
        with patch(
            "services.invoice_extractor.call_claude_content",
            new=AsyncMock(side_effect=AssertionError("LLM must not be called")),
        ):
            result = await extract_and_create_invoice(
                self.conn,
                source_document_id=source_id,
                attachment=text_attachment,
                api_key="test-key",
            )
        self.assertIsNone(result)
        self.assertEqual(len(_invoice_rows(self.conn)), 0)

    async def test_valid_llm_extraction_creates_invoice(self) -> None:
        source_id = self._source_for_pdf()
        llm_json = (
            '{"found": true, "issuer": "ACME OÜ", "invoice_number": "INV-42", '
            '"amount": 199.5, "currency": "EUR", "issue_date": "2026-07-01", '
            '"due_date": "2026-07-31", "confidence": 0.91}'
        )
        with patch(
            "services.invoice_extractor.call_claude_content",
            new=AsyncMock(return_value=llm_json),
        ):
            invoice_id = await extract_and_create_invoice(
                self.conn,
                source_document_id=source_id,
                attachment=_pdf_attachment(),
                api_key="test-key",
            )
        self.assertIsNotNone(invoice_id)
        self.assertEqual(len(_invoice_rows(self.conn)), 1)

        with patch(
            "services.invoice_extractor.call_claude_content",
            new=AsyncMock(return_value=llm_json),
        ):
            again = await extract_and_create_invoice(
                self.conn,
                source_document_id=source_id,
                attachment=_pdf_attachment(),
                api_key="test-key",
            )
        self.assertEqual(again, invoice_id)
        self.assertEqual(len(_invoice_rows(self.conn)), 1)


if __name__ == "__main__":
    unittest.main()
