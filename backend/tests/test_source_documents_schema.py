"""Tests for Finance Vertical v1 — source_documents schema only.

Uses temporary SQLite files. Never touches backend/data/air4.db.
"""

from __future__ import annotations

import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from database import apply_schema  # noqa: E402
from schemas import SourceDocumentCreate, SourceDocumentRead  # noqa: E402


def _temp_db_path() -> Path:
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    path = Path(tmp.name)
    tmp.close()
    return path


def _connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def _table_names(conn: sqlite3.Connection) -> set[str]:
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()
    return {str(r[0]) for r in rows}


def _column_names(conn: sqlite3.Connection, table: str) -> set[str]:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return {str(r[1]) for r in rows}


def _index_names(conn: sqlite3.Connection) -> set[str]:
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='index' AND name IS NOT NULL"
    ).fetchall()
    return {str(r[0]) for r in rows}


class TestSourceDocumentsNewDatabase(unittest.TestCase):
    def setUp(self) -> None:
        self.path = _temp_db_path()
        self.conn = _connect(self.path)

    def tearDown(self) -> None:
        self.conn.close()
        self.path.unlink(missing_ok=True)

    def test_table_creation_on_new_database(self) -> None:
        apply_schema(self.conn)
        self.conn.commit()
        self.assertIn("source_documents", _table_names(self.conn))
        cols = _column_names(self.conn, "source_documents")
        self.assertEqual(
            cols,
            {
                "id",
                "kind",
                "chat_message_id",
                "filename",
                "mime_type",
                "content_text",
                "content_sha256",
                "storage_type",
                "created_at",
            },
        )


class TestSourceDocumentsExistingDatabase(unittest.TestCase):
    def setUp(self) -> None:
        self.path = _temp_db_path()
        self.conn = _connect(self.path)
        # Simulate a pre-Finance-Vertical DB: chat_messages + a sentinel row.
        self.conn.executescript(
            """
            CREATE TABLE chat_messages (
                id INTEGER PRIMARY KEY,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                page TEXT,
                attachment_data TEXT,
                attachment_type TEXT,
                attachment_name TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE uploads (
                id INTEGER PRIMARY KEY,
                filename TEXT NOT NULL,
                account_iban TEXT,
                period_start TEXT,
                period_end TEXT,
                total_transactions INTEGER,
                created_at TEXT DEFAULT (datetime('now'))
            );
            """
        )
        self.conn.execute(
            "INSERT INTO chat_messages (role, content) VALUES ('user', 'hello')"
        )
        self.conn.execute(
            "INSERT INTO uploads (filename, total_transactions) VALUES ('old.csv', 3)"
        )
        self.conn.commit()
        self.msg_id = int(
            self.conn.execute("SELECT id FROM chat_messages").fetchone()[0]
        )
        self.upload_count = int(
            self.conn.execute("SELECT COUNT(*) FROM uploads").fetchone()[0]
        )

    def tearDown(self) -> None:
        self.conn.close()
        self.path.unlink(missing_ok=True)

    def test_initialization_on_existing_database(self) -> None:
        apply_schema(self.conn)
        self.conn.commit()
        self.assertIn("source_documents", _table_names(self.conn))
        # Prior data intact
        row = self.conn.execute(
            "SELECT content FROM chat_messages WHERE id = ?", (self.msg_id,)
        ).fetchone()
        self.assertEqual(row[0], "hello")
        self.assertEqual(
            int(self.conn.execute("SELECT COUNT(*) FROM uploads").fetchone()[0]),
            self.upload_count,
        )

    def test_existing_tables_and_rows_remain_unchanged(self) -> None:
        before_tables = _table_names(self.conn)
        before_msg = dict(
            self.conn.execute(
                "SELECT * FROM chat_messages WHERE id = ?", (self.msg_id,)
            ).fetchone()
        )
        before_upload = dict(
            self.conn.execute("SELECT * FROM uploads WHERE id = 1").fetchone()
        )

        apply_schema(self.conn)
        self.conn.commit()

        after_msg = dict(
            self.conn.execute(
                "SELECT * FROM chat_messages WHERE id = ?", (self.msg_id,)
            ).fetchone()
        )
        after_upload = dict(
            self.conn.execute("SELECT * FROM uploads WHERE id = 1").fetchone()
        )
        self.assertEqual(before_msg, after_msg)
        self.assertEqual(before_upload, after_upload)
        # New table added; previous tables still present
        self.assertTrue(before_tables.issubset(_table_names(self.conn)))
        self.assertIn("source_documents", _table_names(self.conn))


class TestSourceDocumentsIdempotent(unittest.TestCase):
    def setUp(self) -> None:
        self.path = _temp_db_path()
        self.conn = _connect(self.path)

    def tearDown(self) -> None:
        self.conn.close()
        self.path.unlink(missing_ok=True)

    def test_initialization_twice_without_error(self) -> None:
        apply_schema(self.conn)
        self.conn.commit()
        apply_schema(self.conn)
        self.conn.commit()
        self.assertIn("source_documents", _table_names(self.conn))
        self.assertIn(
            "idx_source_documents_content_sha256", _index_names(self.conn)
        )


class TestSourceDocumentsReferencesAndIndex(unittest.TestCase):
    def setUp(self) -> None:
        self.path = _temp_db_path()
        self.conn = _connect(self.path)
        apply_schema(self.conn)
        self.conn.commit()
        cur = self.conn.execute(
            """
            INSERT INTO chat_messages (role, content, attachment_type, attachment_name)
            VALUES ('user', '(см. вложение)', 'application/pdf', 'bill.pdf')
            """
        )
        self.msg_id = int(cur.lastrowid)
        self.conn.commit()

    def tearDown(self) -> None:
        self.conn.close()
        self.path.unlink(missing_ok=True)

    def test_source_document_referencing_chat_message(self) -> None:
        # Provenance only — no base64 copied into source_documents.
        self.conn.execute(
            """
            INSERT INTO source_documents
                (kind, chat_message_id, filename, mime_type, content_sha256, storage_type)
            VALUES ('chat_attachment', ?, 'bill.pdf', 'application/pdf', ?, 'chat_message')
            """,
            (self.msg_id, "a" * 64),
        )
        self.conn.commit()
        row = dict(
            self.conn.execute(
                "SELECT * FROM source_documents WHERE chat_message_id = ?",
                (self.msg_id,),
            ).fetchone()
        )
        self.assertEqual(row["kind"], "chat_attachment")
        self.assertEqual(row["storage_type"], "chat_message")
        self.assertEqual(row["chat_message_id"], self.msg_id)
        self.assertIsNone(row["content_text"])
        # Round-trip through Pydantic read schema
        read = SourceDocumentRead(
            id=int(row["id"]),
            kind=row["kind"],
            storage_type=row["storage_type"],
            chat_message_id=row["chat_message_id"],
            filename=row["filename"],
            mime_type=row["mime_type"],
            content_text=row["content_text"],
            content_sha256=row["content_sha256"],
            created_at=row["created_at"],
        )
        self.assertEqual(read.chat_message_id, self.msg_id)
        create = SourceDocumentCreate(
            kind="chat_attachment",
            storage_type="chat_message",
            chat_message_id=self.msg_id,
            filename="bill.pdf",
            mime_type="application/pdf",
            content_sha256="b" * 64,
        )
        self.assertIsNone(create.content_text)

    def test_invalid_chat_message_id_rejected_with_foreign_keys(self) -> None:
        self.conn.execute("PRAGMA foreign_keys=ON")
        with self.assertRaises(sqlite3.IntegrityError):
            self.conn.execute(
                """
                INSERT INTO source_documents
                    (kind, chat_message_id, storage_type)
                VALUES ('chat_attachment', 999999, 'chat_message')
                """
            )
            self.conn.commit()
        self.conn.rollback()

    def test_content_sha256_index_exists(self) -> None:
        self.assertIn(
            "idx_source_documents_content_sha256", _index_names(self.conn)
        )
        # Index is usable (query plan may vary; existence is the contract).
        row = self.conn.execute(
            """
            SELECT sql FROM sqlite_master
            WHERE type='index' AND name='idx_source_documents_content_sha256'
            """
        ).fetchone()
        self.assertIsNotNone(row)
        self.assertIn("content_sha256", str(row[0]))


class TestSourceDocumentPydantic(unittest.TestCase):
    def test_rejects_unknown_kind(self) -> None:
        with self.assertRaises(Exception):
            SourceDocumentCreate(
                kind="email",  # type: ignore[arg-type]
                storage_type="inline_text",
                content_text="hello",
            )


if __name__ == "__main__":
    unittest.main()
