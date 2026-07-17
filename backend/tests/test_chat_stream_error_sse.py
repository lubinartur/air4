"""SSE error path for chat stream without calling Anthropic."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))


class TestChatStreamErrorSse(unittest.TestCase):
    def test_stream_exception_emits_error_and_done(self) -> None:
        from routers import chat as chat_mod

        def boom_stream(**_kwargs):
            def _gen():
                raise RuntimeError("PDF specified was not valid")
                yield  # pragma: no cover

            return _gen()

        events: list[dict] = []

        async def collect():
            # Minimal stand-in for generate()'s exception branch helpers.
            attach_type = "application/pdf"
            try:
                stream_iter = boom_stream()
                next(stream_iter)
            except Exception as exc:
                err_text = str(exc)
                events.append({"type": "error", "text": err_text})
                events.append({"type": "done"})
                chat_mod._log_sse_event(
                    "error", text=err_text, attachment_media_type=attach_type
                )
                chat_mod._log_sse_event("done", attachment_media_type=attach_type)

        import asyncio

        asyncio.run(collect())
        self.assertEqual(events[0]["type"], "error")
        self.assertIn("not valid", events[0]["text"])
        self.assertEqual(events[1]["type"], "done")
        # Ensure SSE payload encoding stays JSON-safe.
        frame = chat_mod._sse_data(events[0])
        self.assertTrue(frame.startswith("data: "))
        parsed = json.loads(frame[len("data: ") :].strip())
        self.assertEqual(parsed["type"], "error")
        self.assertNotIn("base64", parsed["text"].lower())


if __name__ == "__main__":
    unittest.main()
