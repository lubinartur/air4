"""Tests for Gmail PDF import into SourceDocument + Invoice pipeline."""

from __future__ import annotations

import base64
import hashlib
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
from routers import finance_gmail as finance_gmail_router  # noqa: E402
from schemas import FinanceGmailImportIn  # noqa: E402
from services.finance_gmail import (  # noqa: E402
    GmailAttachmentMissingError,
    GmailInvoiceExtractionError,
    GmailNotPdfError,
    discover_gmail_pdf_candidates,
    external_source_key,
    extract_pdf_attachments_from_message,
    import_gmail_pdf_attachment,
)
from services.gmail_client import GmailAuthError, GmailNotFoundError  # noqa: E402


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


_PDF_BYTES = b"%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"


def _message(
    *,
    message_id: str = "m1",
    parts: list[dict] | None = None,
) -> dict:
    return {
        "id": message_id,
        "threadId": "t1",
        "internalDate": "1720000000000",
        "payload": {
            "headers": [
                {"name": "Subject", "value": "Invoice"},
                {"name": "From", "value": "billing@acme.com"},
            ],
            "parts": parts
            or [
                {
                    "filename": "invoice.pdf",
                    "mimeType": "application/pdf",
                    "headers": [
                        {
                            "name": "Content-Disposition",
                            "value": 'attachment; filename="invoice.pdf"',
                        }
                    ],
                    "body": {"attachmentId": "att-1", "size": len(_PDF_BYTES)},
                }
            ],
        },
    }


class _FakeGmailClient:
    def __init__(
        self,
        *,
        message: dict | None = None,
        attachment_bytes: bytes = _PDF_BYTES,
        get_message_error: Exception | None = None,
        get_attachment_error: Exception | None = None,
        refs: list[dict[str, str]] | None = None,
    ) -> None:
        self.message = message or _message()
        self.attachment_bytes = attachment_bytes
        self.get_message_error = get_message_error
        self.get_attachment_error = get_attachment_error
        self.refs = refs if refs is not None else [{"id": "m1", "threadId": "t1"}]
        self.downloaded_ids: list[tuple[str, str]] = []

    def list_message_refs(self, query: str, *, max_results: int = 25):
        return list(self.refs)

    def get_message(self, message_id: str) -> dict:
        if self.get_message_error:
            raise self.get_message_error
        return self.message

    def get_attachment(self, message_id: str, attachment_id: str) -> bytes:
        if self.get_attachment_error:
            raise self.get_attachment_error
        self.downloaded_ids.append((message_id, attachment_id))
        return self.attachment_bytes


class TestGmailImport(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.path = _temp_db_path()
        self.conn = _connect(self.path)
        apply_schema(self.conn)
        self.conn.commit()

    def tearDown(self) -> None:
        self.conn.close()
        self.path.unlink(missing_ok=True)

    async def test_imports_valid_gmail_pdf_into_source_and_invoice(self) -> None:
        client = _FakeGmailClient()
        fields = {
            "issuer": "ACME",
            "invoice_number": "1",
            "amount": 10.0,
            "currency": "EUR",
            "issue_date": "2026-07-01",
            "due_date": "2026-07-31",
            "confidence": 0.9,
            "status": "draft",
        }
        with patch(
            "services.finance_gmail.extract_invoice_fields",
            new=AsyncMock(return_value=fields),
        ) as extract_mock:
            result = await import_gmail_pdf_attachment(
                self.conn,
                gmail_message_id="m1",
                attachment_id="att-1",
                client=client,
                api_key="test",
            )

        self.assertFalse(result["already_imported"])
        self.assertIsNotNone(result["invoice_id"])
        self.assertEqual(result["invoice_status"], "draft")
        self.assertEqual(client.downloaded_ids, [("m1", "att-1")])

        # Extractor received authoritative PDF bytes as base64 — not FE metadata.
        call_att = extract_mock.await_args.args[0]
        self.assertEqual(call_att["media_type"], "application/pdf")
        self.assertEqual(call_att["name"], "invoice.pdf")
        self.assertEqual(base64.b64decode(call_att["data"]), _PDF_BYTES)

        src = self.conn.execute(
            "SELECT * FROM source_documents WHERE id = ?",
            (result["source_document_id"],),
        ).fetchone()
        self.assertEqual(src["source_type"], "gmail")
        self.assertEqual(src["external_source_key"], "gmail:m1:att-1")
        self.assertEqual(src["kind"], "pdf")
        self.assertEqual(src["storage_type"], "external_reference")
        self.assertIsNone(src["chat_message_id"])
        self.assertEqual(
            src["content_sha256"], hashlib.sha256(_PDF_BYTES).hexdigest()
        )

        inv = self.conn.execute(
            "SELECT * FROM invoices WHERE id = ?", (result["invoice_id"],)
        ).fetchone()
        self.assertEqual(inv["source_document_id"], result["source_document_id"])
        self.assertEqual(inv["issuer"], "ACME")
        self.assertEqual(inv["status"], "draft")

    async def test_repeated_import_is_idempotent(self) -> None:
        client = _FakeGmailClient()
        fields = {
            "issuer": "ACME",
            "amount": 10.0,
            "currency": "EUR",
            "due_date": "2026-07-31",
            "confidence": 0.8,
            "status": "draft",
        }
        with patch(
            "services.finance_gmail.extract_invoice_fields",
            new=AsyncMock(return_value=fields),
        ):
            first = await import_gmail_pdf_attachment(
                self.conn,
                gmail_message_id="m1",
                attachment_id="att-1",
                client=client,
                api_key="test",
            )
            second = await import_gmail_pdf_attachment(
                self.conn,
                gmail_message_id="m1",
                attachment_id="att-1",
                client=client,
                api_key="test",
            )
        self.assertEqual(first["source_document_id"], second["source_document_id"])
        self.assertEqual(first["invoice_id"], second["invoice_id"])
        self.assertTrue(second["already_imported"])
        self.assertEqual(len(client.downloaded_ids), 1)
        self.assertEqual(
            int(self.conn.execute("SELECT COUNT(*) FROM source_documents").fetchone()[0]),
            1,
        )
        self.assertEqual(
            int(self.conn.execute("SELECT COUNT(*) FROM invoices").fetchone()[0]),
            1,
        )

    async def test_discovery_marks_imported_candidate(self) -> None:
        client = _FakeGmailClient()
        fields = {
            "issuer": "ACME",
            "amount": 10.0,
            "currency": "EUR",
            "due_date": "2026-07-31",
            "confidence": 0.8,
            "status": "draft",
        }
        with patch(
            "services.finance_gmail.extract_invoice_fields",
            new=AsyncMock(return_value=fields),
        ):
            imported = await import_gmail_pdf_attachment(
                self.conn,
                gmail_message_id="m1",
                attachment_id="att-1",
                client=client,
                api_key="test",
            )
        rows = discover_gmail_pdf_candidates(client, db=self.conn)
        self.assertEqual(len(rows), 1)
        self.assertTrue(rows[0]["already_imported"])
        self.assertEqual(rows[0]["invoice_id"], imported["invoice_id"])
        self.assertEqual(rows[0]["invoice_status"], "draft")
        self.assertEqual(
            rows[0]["external_source_key"],
            external_source_key("m1", "att-1"),
        )

    async def test_missing_message_returns_not_found(self) -> None:
        client = _FakeGmailClient(
            get_message_error=GmailNotFoundError("Gmail resource not found.")
        )
        with self.assertRaises(GmailNotFoundError):
            await import_gmail_pdf_attachment(
                self.conn,
                gmail_message_id="missing",
                attachment_id="att-1",
                client=client,
                api_key="test",
            )

    async def test_missing_attachment_returns_not_found(self) -> None:
        client = _FakeGmailClient(message=_message())
        with self.assertRaises(GmailAttachmentMissingError):
            await import_gmail_pdf_attachment(
                self.conn,
                gmail_message_id="m1",
                attachment_id="nope",
                client=client,
                api_key="test",
            )

    async def test_non_pdf_returns_bad_request(self) -> None:
        msg = _message(
            parts=[
                {
                    "filename": "photo.png",
                    "mimeType": "image/png",
                    "body": {"attachmentId": "img-1", "size": 10},
                }
            ]
        )
        client = _FakeGmailClient(message=msg, attachment_bytes=b"PNG")
        with self.assertRaises(GmailNotPdfError):
            await import_gmail_pdf_attachment(
                self.conn,
                gmail_message_id="m1",
                attachment_id="img-1",
                client=client,
                api_key="test",
            )
        self.assertEqual(
            int(self.conn.execute("SELECT COUNT(*) FROM source_documents").fetchone()[0]),
            0,
        )

    async def test_extraction_failure_keeps_source_no_invoice(self) -> None:
        client = _FakeGmailClient()
        with patch(
            "services.finance_gmail.extract_invoice_fields",
            new=AsyncMock(return_value=None),
        ):
            with self.assertRaises(GmailInvoiceExtractionError) as ctx:
                await import_gmail_pdf_attachment(
                    self.conn,
                    gmail_message_id="m1",
                    attachment_id="att-1",
                    client=client,
                    api_key="test",
                )
        self.assertGreater(ctx.exception.source_document_id, 0)
        self.assertEqual(
            int(self.conn.execute("SELECT COUNT(*) FROM source_documents").fetchone()[0]),
            1,
        )
        self.assertEqual(
            int(self.conn.execute("SELECT COUNT(*) FROM invoices").fetchone()[0]),
            0,
        )


class TestGmailImportEndpoint(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.path = _temp_db_path()
        self.conn = _connect(self.path)
        apply_schema(self.conn)
        self.conn.commit()

    def tearDown(self) -> None:
        self.conn.close()
        self.path.unlink(missing_ok=True)

    async def test_endpoint_auth_failure_401(self) -> None:
        from contextlib import contextmanager

        from fastapi import HTTPException

        @contextmanager
        def _fake_db():
            yield self.conn

        with (
            patch.object(finance_gmail_router, "get_db", _fake_db),
            patch(
                "routers.finance_gmail.import_gmail_pdf_attachment",
                new=AsyncMock(side_effect=GmailAuthError("not connected")),
            ),
        ):
            with self.assertRaises(HTTPException) as ctx:
                await finance_gmail_router.post_finance_gmail_import(
                    FinanceGmailImportIn(
                        gmail_message_id="m1", attachment_id="a1"
                    )
                )
        self.assertEqual(ctx.exception.status_code, 401)

    async def test_endpoint_extraction_failed_keeps_source(self) -> None:
        from contextlib import contextmanager

        @contextmanager
        def _fake_db():
            yield self.conn

        with (
            patch.object(finance_gmail_router, "get_db", _fake_db),
            patch(
                "routers.finance_gmail.import_gmail_pdf_attachment",
                new=AsyncMock(
                    side_effect=GmailInvoiceExtractionError(
                        "extract failed", source_document_id=7
                    )
                ),
            ),
        ):
            out = await finance_gmail_router.post_finance_gmail_import(
                FinanceGmailImportIn(gmail_message_id="m1", attachment_id="a1")
            )
        self.assertTrue(out.extraction_failed)
        self.assertEqual(out.source_document_id, 7)
        self.assertIsNone(out.invoice_id)


class TestExtractStillFilters(unittest.TestCase):
    def test_excludes_attachments_without_ids(self) -> None:
        msg = _message(
            parts=[
                {
                    "filename": "no-id.pdf",
                    "mimeType": "application/pdf",
                    "body": {"size": 10},
                },
                {
                    "filename": "ok.pdf",
                    "mimeType": "application/pdf",
                    "body": {"attachmentId": "a5", "size": 10},
                },
            ]
        )
        rows = extract_pdf_attachments_from_message(msg)
        self.assertEqual([r["filename"] for r in rows], ["ok.pdf"])


if __name__ == "__main__":
    unittest.main()
