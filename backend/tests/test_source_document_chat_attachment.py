"""Tests for chat attachment → source_documents provenance (Finance Vertical).

Uses temporary SQLite with apply_schema. Never touches backend/data/air4.db.
"""

from __future__ import annotations

import base64
import hashlib
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from database import apply_schema  # noqa: E402
from services.chat_history import save_exchange  # noqa: E402
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


def _tiny_png_b64() -> str:
    return (
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8"
        "z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    )


def _source_document_rows(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        """
        SELECT id, kind, chat_message_id, filename, mime_type, content_sha256,
               storage_type, size_bytes, created_at
        FROM source_documents
        ORDER BY id
        """
    ).fetchall()
    return [dict(r) for r in rows]


class TestChatAttachmentSourceDocuments(unittest.TestCase):
    def setUp(self) -> None:
        self.path = _temp_db_path()
        self.conn = _connect(self.path)
        apply_schema(self.conn)
        self.conn.commit()

    def tearDown(self) -> None:
        self.conn.close()
        self.path.unlink(missing_ok=True)

    def test_pdf_upload_creates_source_document(self) -> None:
        b64 = _tiny_pdf_b64()
        payload = base64.b64decode(b64)
        expected_sha = hashlib.sha256(payload).hexdigest()

        save_exchange(
            self.conn,
            user_message="Разбери счёт",
            assistant_message="Принял PDF.",
            page="Finance",
            attachment={
                "data": b64,
                "media_type": "application/pdf",
                "name": "invoice.pdf",
            },
        )

        docs = _source_document_rows(self.conn)
        self.assertEqual(len(docs), 1)
        doc = docs[0]
        user_id = int(
            self.conn.execute(
                "SELECT id FROM chat_messages WHERE role = 'user' ORDER BY id DESC LIMIT 1"
            ).fetchone()[0]
        )
        self.assertEqual(doc["kind"], "pdf")
        self.assertEqual(doc["storage_type"], "chat_attachment")
        self.assertEqual(doc["chat_message_id"], user_id)
        self.assertEqual(doc["filename"], "invoice.pdf")
        self.assertEqual(doc["mime_type"], "application/pdf")
        self.assertEqual(doc["content_sha256"], expected_sha)
        self.assertEqual(doc["size_bytes"], len(payload))
        self.assertIsNotNone(doc["created_at"])

    def test_image_upload_creates_source_document(self) -> None:
        b64 = _tiny_png_b64()
        payload = base64.b64decode(b64)
        expected_sha = hashlib.sha256(payload).hexdigest()

        save_exchange(
            self.conn,
            user_message="Что на скрине?",
            assistant_message="Вижу изображение.",
            page="Chat",
            attachment={
                "data": b64,
                "media_type": "image/png",
                "name": "shot.png",
            },
        )

        docs = _source_document_rows(self.conn)
        self.assertEqual(len(docs), 1)
        doc = docs[0]
        self.assertEqual(doc["kind"], "image")
        self.assertEqual(doc["storage_type"], "chat_attachment")
        self.assertEqual(doc["filename"], "shot.png")
        self.assertEqual(doc["mime_type"], "image/png")
        self.assertEqual(doc["content_sha256"], expected_sha)
        self.assertEqual(doc["size_bytes"], len(payload))

    def test_duplicate_upload_does_not_create_duplicate_source_document(self) -> None:
        b64 = _tiny_pdf_b64()
        attachment = {
            "data": b64,
            "media_type": "application/pdf",
            "name": "invoice.pdf",
        }

        save_exchange(
            self.conn,
            user_message="Счёт",
            assistant_message="Ок.",
            attachment=attachment,
        )
        user_id = int(
            self.conn.execute(
                "SELECT id FROM chat_messages WHERE role = 'user' ORDER BY id DESC LIMIT 1"
            ).fetchone()[0]
        )
        record_chat_attachment_source(self.conn, user_id, attachment)

        docs = _source_document_rows(self.conn)
        self.assertEqual(len(docs), 1)
        self.assertEqual(docs[0]["chat_message_id"], user_id)
        self.assertEqual(docs[0]["filename"], "invoice.pdf")

    def test_same_pdf_two_messages_creates_two_source_documents(self) -> None:
        b64 = _tiny_pdf_b64()

        save_exchange(
            self.conn,
            user_message="Первый счёт",
            assistant_message="Ок.",
            attachment={
                "data": b64,
                "media_type": "application/pdf",
                "name": "first.pdf",
            },
        )
        save_exchange(
            self.conn,
            user_message="Второй счёт",
            assistant_message="Снова ок.",
            attachment={
                "data": b64,
                "media_type": "application/pdf",
                "name": "second.pdf",
            },
        )

        docs = _source_document_rows(self.conn)
        self.assertEqual(len(docs), 2)
        message_ids = {doc["chat_message_id"] for doc in docs}
        self.assertEqual(len(message_ids), 2)
        filenames = {doc["filename"] for doc in docs}
        self.assertEqual(filenames, {"first.pdf", "second.pdf"})
        self.assertEqual(docs[0]["content_sha256"], docs[1]["content_sha256"])

    def test_text_only_chat_creates_no_source_document(self) -> None:
        save_exchange(
            self.conn,
            user_message="Привет",
            assistant_message="Здравствуй",
            page="Chat",
        )
        self.assertEqual(
            int(self.conn.execute("SELECT COUNT(*) FROM source_documents").fetchone()[0]),
            0,
        )


if __name__ == "__main__":
    unittest.main()
