"""Tests for Gmail finance discovery (read-only candidates)."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from routers.finance_gmail import get_finance_gmail_candidates  # noqa: E402
from services.finance_gmail import (  # noqa: E402
    discover_gmail_pdf_candidates,
    extract_pdf_attachments_from_message,
)
from services.gmail_client import GmailApiError, GmailAuthError  # noqa: E402


def _message(
    *,
    message_id: str = "m1",
    thread_id: str = "t1",
    subject: str = "Invoice ACME",
    sender: str = "billing@acme.com",
    parts: list[dict],
) -> dict:
    return {
        "id": message_id,
        "threadId": thread_id,
        "internalDate": "1720000000000",
        "payload": {
            "headers": [
                {"name": "Subject", "value": subject},
                {"name": "From", "value": f"ACME <{sender}>"},
            ],
            "parts": parts,
        },
    }


def _pdf_part(
    *,
    filename: str = "invoice.pdf",
    attachment_id: str | None = "att-1",
    mime: str = "application/pdf",
    size: int = 12000,
    disposition: str | None = "attachment",
) -> dict:
    headers = []
    if disposition:
        headers.append(
            {
                "name": "Content-Disposition",
                "value": f'{disposition}; filename="{filename}"',
            }
        )
    body: dict = {"size": size}
    if attachment_id is not None:
        body["attachmentId"] = attachment_id
    return {
        "filename": filename,
        "mimeType": mime,
        "headers": headers,
        "body": body,
    }


class _FakeGmailClient:
    def __init__(
        self,
        refs: list[dict[str, str]] | None = None,
        messages: dict[str, dict] | None = None,
        *,
        list_error: Exception | None = None,
    ) -> None:
        self.refs = refs or []
        self.messages = messages or {}
        self.list_error = list_error

    def list_message_refs(self, query: str, *, max_results: int = 25):
        if self.list_error:
            raise self.list_error
        return list(self.refs)

    def get_message(self, message_id: str) -> dict:
        if message_id not in self.messages:
            raise GmailApiError(f"missing {message_id}")
        return self.messages[message_id]


class TestExtractPdfAttachments(unittest.TestCase):
    def test_returns_only_pdf_attachment_candidates(self) -> None:
        msg = _message(
            parts=[
                _pdf_part(filename="bill.pdf", attachment_id="a1"),
                _pdf_part(
                    filename="photo.png",
                    attachment_id="a2",
                    mime="image/png",
                    size=400,
                ),
                _pdf_part(
                    filename="logo.png",
                    attachment_id="a3",
                    mime="image/png",
                    disposition="inline",
                ),
                {
                    "filename": "notes.txt",
                    "mimeType": "text/plain",
                    "body": {"attachmentId": "a4", "size": 10},
                },
            ]
        )
        rows = extract_pdf_attachments_from_message(msg)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["filename"], "bill.pdf")
        self.assertEqual(rows[0]["attachment_id"], "a1")
        self.assertEqual(rows[0]["gmail_message_id"], "m1")
        self.assertEqual(rows[0]["gmail_thread_id"], "t1")
        self.assertEqual(rows[0]["sender"], "billing@acme.com")
        self.assertFalse(rows[0]["already_imported"])
        self.assertTrue(rows[0]["external_source_key"].startswith("gmail:m1:"))

    def test_excludes_attachments_without_ids(self) -> None:
        msg = _message(
            parts=[
                _pdf_part(filename="no-id.pdf", attachment_id=None),
                _pdf_part(filename="", attachment_id="a9"),
                _pdf_part(filename="ok.pdf", attachment_id="a5"),
            ]
        )
        rows = extract_pdf_attachments_from_message(msg)
        self.assertEqual([r["filename"] for r in rows], ["ok.pdf"])


class TestDiscoverCandidates(unittest.TestCase):
    def test_handles_empty_gmail_result(self) -> None:
        client = _FakeGmailClient(refs=[])
        self.assertEqual(discover_gmail_pdf_candidates(client), [])

    def test_discover_aggregates_messages(self) -> None:
        client = _FakeGmailClient(
            refs=[{"id": "m1", "threadId": "t1"}],
            messages={
                "m1": _message(
                    parts=[_pdf_part(filename="a.pdf", attachment_id="x1")]
                )
            },
        )
        rows = discover_gmail_pdf_candidates(client)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["filename"], "a.pdf")


class TestGmailCandidatesEndpoint(unittest.TestCase):
    def test_endpoint_empty(self) -> None:
        with patch(
            "routers.finance_gmail.discover_gmail_pdf_candidates",
            return_value=[],
        ):
            out = get_finance_gmail_candidates()
        self.assertEqual(out.candidates, [])

    def test_endpoint_auth_failure(self) -> None:
        from fastapi import HTTPException

        with patch(
            "routers.finance_gmail.discover_gmail_pdf_candidates",
            side_effect=GmailAuthError("Gmail is not connected"),
        ):
            with self.assertRaises(HTTPException) as ctx:
                get_finance_gmail_candidates()
        self.assertEqual(ctx.exception.status_code, 401)

    def test_endpoint_api_failure(self) -> None:
        from fastapi import HTTPException

        with patch(
            "routers.finance_gmail.discover_gmail_pdf_candidates",
            side_effect=GmailApiError("upstream down"),
        ):
            with self.assertRaises(HTTPException) as ctx:
                get_finance_gmail_candidates()
        self.assertEqual(ctx.exception.status_code, 502)


if __name__ == "__main__":
    unittest.main()
