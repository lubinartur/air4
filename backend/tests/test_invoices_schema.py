"""Tests for Finance Vertical v1 — invoices schema only.

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
from schemas import InvoiceCreate, InvoiceRead  # noqa: E402


_INVOICE_COLUMNS = {
    "id",
    "source_document_id",
    "issuer",
    "invoice_number",
    "amount",
    "currency",
    "due_date",
    "issue_date",
    "status",
    "confidence",
    "created_at",
    "updated_at",
}


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


def _insert_source_document(conn: sqlite3.Connection) -> int:
    cur = conn.execute(
        """
        INSERT INTO source_documents (kind, storage_type, content_text, content_sha256)
        VALUES ('pasted_text', 'inline_text', 'Invoice ACME 100 EUR', ?)
        """,
        ("c" * 64,),
    )
    conn.commit()
    return int(cur.lastrowid)


class TestInvoicesNewDatabase(unittest.TestCase):
    def setUp(self) -> None:
        self.path = _temp_db_path()
        self.conn = _connect(self.path)

    def tearDown(self) -> None:
        self.conn.close()
        self.path.unlink(missing_ok=True)

    def test_table_creation_on_new_database(self) -> None:
        apply_schema(self.conn)
        self.conn.commit()
        self.assertIn("invoices", _table_names(self.conn))
        self.assertIn("source_documents", _table_names(self.conn))
        self.assertEqual(_column_names(self.conn, "invoices"), _INVOICE_COLUMNS)


class TestInvoicesExistingDatabase(unittest.TestCase):
    def setUp(self) -> None:
        self.path = _temp_db_path()
        self.conn = _connect(self.path)
        self.conn.executescript(
            """
            CREATE TABLE chat_messages (
                id INTEGER PRIMARY KEY,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE source_documents (
                id INTEGER PRIMARY KEY,
                kind TEXT NOT NULL,
                chat_message_id INTEGER REFERENCES chat_messages(id),
                filename TEXT,
                mime_type TEXT,
                content_text TEXT,
                content_sha256 TEXT,
                storage_type TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now'))
            );
            """
        )
        self.conn.execute(
            "INSERT INTO chat_messages (role, content) VALUES ('user', 'keep me')"
        )
        self.conn.execute(
            """
            INSERT INTO source_documents (kind, storage_type, content_text)
            VALUES ('pasted_text', 'inline_text', 'old source')
            """
        )
        self.conn.commit()
        self.src_id = int(
            self.conn.execute("SELECT id FROM source_documents").fetchone()[0]
        )
        self.msg_content = "keep me"

    def tearDown(self) -> None:
        self.conn.close()
        self.path.unlink(missing_ok=True)

    def test_initialization_on_existing_database(self) -> None:
        apply_schema(self.conn)
        self.conn.commit()
        self.assertIn("invoices", _table_names(self.conn))
        self.assertEqual(
            _column_names(self.conn, "invoices"), _INVOICE_COLUMNS
        )

    def test_existing_data_unchanged(self) -> None:
        before_src = dict(
            self.conn.execute(
                "SELECT * FROM source_documents WHERE id = ?", (self.src_id,)
            ).fetchone()
        )
        before_msg = self.conn.execute(
            "SELECT content FROM chat_messages LIMIT 1"
        ).fetchone()[0]

        apply_schema(self.conn)
        self.conn.commit()

        after_src = dict(
            self.conn.execute(
                "SELECT * FROM source_documents WHERE id = ?", (self.src_id,)
            ).fetchone()
        )
        after_msg = self.conn.execute(
            "SELECT content FROM chat_messages LIMIT 1"
        ).fetchone()[0]
        expected_src = dict(before_src)
        expected_src["size_bytes"] = None
        self.assertEqual(after_src, expected_src)
        self.assertEqual(before_msg, after_msg)
        self.assertEqual(after_msg, self.msg_content)


class TestInvoicesIdempotent(unittest.TestCase):
    def setUp(self) -> None:
        self.path = _temp_db_path()
        self.conn = _connect(self.path)

    def tearDown(self) -> None:
        self.conn.close()
        self.path.unlink(missing_ok=True)

    def test_double_initialization(self) -> None:
        apply_schema(self.conn)
        self.conn.commit()
        apply_schema(self.conn)
        self.conn.commit()
        self.assertIn("invoices", _table_names(self.conn))
        self.assertEqual(
            _column_names(self.conn, "invoices"), _INVOICE_COLUMNS
        )


class TestInvoicesForeignKey(unittest.TestCase):
    def setUp(self) -> None:
        self.path = _temp_db_path()
        self.conn = _connect(self.path)
        apply_schema(self.conn)
        self.conn.commit()
        self.src_id = _insert_source_document(self.conn)

    def tearDown(self) -> None:
        self.conn.close()
        self.path.unlink(missing_ok=True)

    def test_valid_source_document_fk(self) -> None:
        self.conn.execute(
            """
            INSERT INTO invoices
                (source_document_id, issuer, invoice_number, amount, currency,
                 due_date, issue_date, status, confidence)
            VALUES (?, 'ACME OÜ', 'INV-1', 100.0, 'EUR',
                    '2026-08-01', '2026-07-01', 'draft', 0.9)
            """,
            (self.src_id,),
        )
        self.conn.commit()
        row = dict(
            self.conn.execute(
                "SELECT * FROM invoices WHERE source_document_id = ?",
                (self.src_id,),
            ).fetchone()
        )
        self.assertEqual(row["issuer"], "ACME OÜ")
        self.assertEqual(row["status"], "draft")
        read = InvoiceRead(
            id=int(row["id"]),
            source_document_id=row["source_document_id"],
            issuer=row["issuer"],
            invoice_number=row["invoice_number"],
            amount=row["amount"],
            currency=row["currency"],
            due_date=row["due_date"],
            issue_date=row["issue_date"],
            status=row["status"],
            confidence=row["confidence"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )
        self.assertEqual(read.source_document_id, self.src_id)
        create = InvoiceCreate(
            source_document_id=self.src_id,
            issuer="ACME OÜ",
            amount=100.0,
            status="draft",
        )
        self.assertEqual(create.status, "draft")

    def test_invalid_source_document_id_rejected(self) -> None:
        self.conn.execute("PRAGMA foreign_keys=ON")
        with self.assertRaises(sqlite3.IntegrityError):
            self.conn.execute(
                """
                INSERT INTO invoices (status, source_document_id)
                VALUES ('draft', 999999)
                """
            )
            self.conn.commit()
        self.conn.rollback()


class TestInvoiceInvalidStatus(unittest.TestCase):
    def test_rejects_unknown_status(self) -> None:
        with self.assertRaises(Exception):
            InvoiceCreate(
                status="archived",  # type: ignore[arg-type]
                issuer="X",
            )


if __name__ == "__main__":
    unittest.main()
