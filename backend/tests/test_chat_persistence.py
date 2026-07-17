"""Focused regression tests for chat exchange + attachment persistence (T0).

Uses an isolated temporary SQLite file. Never touches backend/data/air4.db.
Does not call the Anthropic API.
"""

from __future__ import annotations

import base64
import logging
import sqlite3
import sys
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

# Ensure `backend/` is on sys.path when pytest/unittest is run from repo root
# or from backend/.
_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from services.chat_history import (  # noqa: E402
    fetch_recent_chat_messages,
    save_exchange,
)


_CHAT_MESSAGES_DDL = """
CREATE TABLE IF NOT EXISTS chat_messages (
    id              INTEGER PRIMARY KEY,
    role            TEXT NOT NULL,
    content         TEXT NOT NULL,
    page            TEXT,
    attachment_data TEXT,
    attachment_type TEXT,
    attachment_name TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
);
"""


def _tiny_pdf_b64() -> str:
    # Minimal valid-ish PDF bytes — content does not matter for persistence.
    return base64.b64encode(
        b"%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
    ).decode("ascii")


def _tiny_png_b64() -> str:
    # 1x1 transparent PNG
    return (
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8"
        "z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    )


class _TempChatDb:
    """Temporary SQLite with only chat_messages — isolated from air4.db."""

    def __init__(self) -> None:
        self._tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.path = Path(self._tmp.name)
        self._tmp.close()

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        conn.executescript(_CHAT_MESSAGES_DDL)
        conn.commit()
        return conn

    def cleanup(self) -> None:
        try:
            self.path.unlink(missing_ok=True)
        except OSError:
            pass


class TestTextExchangePersistence(unittest.TestCase):
    def setUp(self) -> None:
        self.db = _TempChatDb()
        self.conn = self.db.connect()

    def tearDown(self) -> None:
        self.conn.close()
        self.db.cleanup()

    def test_user_and_assistant_persisted_in_order(self) -> None:
        save_exchange(
            self.conn,
            user_message="Привет",
            assistant_message="Здравствуй",
            page="Chat",
        )
        rows = fetch_recent_chat_messages(self.conn, limit=10)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["role"], "user")
        self.assertEqual(rows[0]["content"], "Привет")
        self.assertIsNone(rows[0]["attachment_data"])
        self.assertEqual(rows[1]["role"], "assistant")
        self.assertEqual(rows[1]["content"], "Здравствуй")
        self.assertIsNone(rows[1]["attachment_data"])


class TestPdfAttachmentPersistence(unittest.TestCase):
    def setUp(self) -> None:
        self.db = _TempChatDb()
        self.conn = self.db.connect()
        self.b64 = _tiny_pdf_b64()

    def tearDown(self) -> None:
        self.conn.close()
        self.db.cleanup()

    def test_pdf_fields_on_user_only(self) -> None:
        save_exchange(
            self.conn,
            user_message="Разбери этот счёт",
            assistant_message="Вижу PDF.",
            page="Finance",
            attachment={
                "data": self.b64,
                "media_type": "application/pdf",
                "name": "invoice.pdf",
            },
        )
        rows = fetch_recent_chat_messages(self.conn, limit=10)
        self.assertEqual(len(rows), 2)

        user, assistant = rows[0], rows[1]
        self.assertEqual(user["role"], "user")
        self.assertEqual(user["attachment_type"], "application/pdf")
        self.assertEqual(user["attachment_name"], "invoice.pdf")
        self.assertEqual(user["attachment_data"], self.b64)

        self.assertEqual(assistant["role"], "assistant")
        self.assertIsNone(assistant["attachment_data"])
        self.assertIsNone(assistant["attachment_type"])
        self.assertIsNone(assistant["attachment_name"])


class TestImageAttachmentPersistence(unittest.TestCase):
    def setUp(self) -> None:
        self.db = _TempChatDb()
        self.conn = self.db.connect()
        self.b64 = _tiny_png_b64()

    def tearDown(self) -> None:
        self.conn.close()
        self.db.cleanup()

    def test_image_fields_on_user_only(self) -> None:
        save_exchange(
            self.conn,
            user_message="Что на скрине?",
            assistant_message="Это изображение.",
            page="Chat",
            attachment={
                "data": self.b64,
                "media_type": "image/png",
                "name": "shot.png",
            },
        )
        rows = fetch_recent_chat_messages(self.conn, limit=10)
        self.assertEqual(len(rows), 2)

        user, assistant = rows[0], rows[1]
        self.assertEqual(user["attachment_type"], "image/png")
        self.assertEqual(user["attachment_name"], "shot.png")
        self.assertEqual(user["attachment_data"], self.b64)
        self.assertIsNone(assistant["attachment_data"])


class TestPersistExchangeIntegration(unittest.TestCase):
    """Exercise routers.chat._persist_exchange against a temp DB."""

    def setUp(self) -> None:
        self.db = _TempChatDb()
        self.conn = self.db.connect()

    def tearDown(self) -> None:
        self.conn.close()
        self.db.cleanup()

    def test_persist_exchange_writes_attachment_via_router_helper(self) -> None:
        import routers.chat as chat_mod

        self.assertTrue(
            hasattr(chat_mod, "save_exchange"),
            "chat.py must import save_exchange (T0 regression guard)",
        )

        @contextmanager
        def _fake_get_db():
            yield self.conn

        b64 = _tiny_pdf_b64()
        with (
            patch.object(chat_mod, "get_db", _fake_get_db),
            patch.object(chat_mod, "mark_sent_followups_answered"),
            patch.object(chat_mod, "mark_gaps_asked_in_response"),
        ):
            chat_mod._persist_exchange(
                "Счёт во вложении",
                "Принял PDF.",
                "Finance",
                attachment={
                    "data": b64,
                    "media_type": "application/pdf",
                    "name": "bill.pdf",
                },
            )

        rows = fetch_recent_chat_messages(self.conn, limit=10)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["attachment_name"], "bill.pdf")
        self.assertEqual(rows[0]["attachment_data"], b64)
        self.assertIsNone(rows[1]["attachment_data"])


class TestPersistenceFailureVisibility(unittest.TestCase):
    def test_persist_failure_logged_without_payload(self) -> None:
        import routers.chat as chat_mod

        secret_b64 = "QUFBQUFBQUFBQUE="  # "AAAAAAAAAA" — must not appear in logs
        attachment = {
            "data": secret_b64,
            "media_type": "application/pdf",
            "name": "secret.pdf",
        }
        secret_user_text = "SENSITIVE_USER_MESSAGE_SHOULD_NOT_LOG"

        with (
            patch.object(
                chat_mod,
                "save_exchange",
                side_effect=RuntimeError("disk full"),
            ),
            self.assertLogs(chat_mod.logger, level="ERROR") as captured,
        ):
            chat_mod._persist_exchange(
                secret_user_text,
                "assistant reply",
                "Chat",
                attachment=attachment,
            )

        joined = "\n".join(captured.output)
        self.assertIn("Failed to persist chat exchange", joined)
        self.assertIn("has_attachment=True", joined)
        self.assertIn("disk full", joined)
        self.assertNotIn(secret_b64, joined)
        self.assertNotIn(secret_user_text, joined)
        self.assertNotIn("SENSITIVE", joined)


if __name__ == "__main__":
    unittest.main()
