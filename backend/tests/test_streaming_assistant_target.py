"""Regression: streaming deltas must target the in-flight assistant bubble.

Mirrors design-reference/src/lib/chatStreamMessages.ts and
appendAssistantIfNew() so a proactive brief cannot steal PDF/text deltas.
"""

from __future__ import annotations

import unittest
from typing import Any


def find_streaming_assistant_index(messages: list[dict[str, Any]]) -> int:
    for i in range(len(messages) - 1, -1, -1):
        m = messages[i]
        if m.get("role") == "assistant" and m.get("isStreaming"):
            return i
    return -1


def patch_streaming_assistant(
    prev: list[dict[str, Any]], patch_fn
) -> list[dict[str, Any]]:
    idx = find_streaming_assistant_index(prev)
    if idx == -1:
        return prev
    next_msgs = list(prev)
    next_msgs[idx] = patch_fn(prev[idx])
    return next_msgs


def append_assistant_if_new(
    prev: list[dict[str, Any]], content: str
) -> list[dict[str, Any]]:
    if any(
        m.get("role") == "assistant" and (m.get("content") or "").strip() == content.strip()
        for m in prev
    ):
        return prev
    msg = {"role": "assistant", "content": content}
    stream_idx = next(
        (
            i
            for i, m in enumerate(prev)
            if m.get("role") == "assistant" and m.get("isStreaming")
        ),
        -1,
    )
    if stream_idx == -1:
        return prev + [msg]
    return prev[:stream_idx] + [msg] + prev[stream_idx:]


class TestStreamingAssistantTarget(unittest.TestCase):
    def test_deltas_survive_proactive_brief_insert(self) -> None:
        messages: list[dict[str, Any]] = [
            {"role": "user", "content": "", "attachment": True},
            {
                "role": "assistant",
                "content": "",
                "isStreaming": True,
                "chunks": [],
            },
        ]
        # Morning brief arrives while PDF stream is in flight.
        messages = append_assistant_if_new(messages, "Доброе утро — краткий бриф.")
        self.assertEqual(messages[-1]["isStreaming"], True)
        self.assertEqual(messages[-2]["content"], "Доброе утро — краткий бриф.")

        messages = patch_streaming_assistant(
            messages,
            lambda last: {
                **last,
                "content": last["content"] + "Счёт на €10.",
                "isStreaming": True,
            },
        )
        stream = messages[find_streaming_assistant_index(messages)]
        self.assertIn("Счёт на €10.", stream["content"])
        self.assertEqual(messages[-2]["content"], "Доброе утро — краткий бриф.")

    def test_old_last_message_behavior_was_wrong(self) -> None:
        """Document the pre-fix bug: writing to messages[-1] lost the reply."""
        messages: list[dict[str, Any]] = [
            {"role": "user", "content": "(см. вложение)"},
            {"role": "assistant", "content": "", "isStreaming": True},
            {"role": "assistant", "content": "brief"},  # stole the tail
        ]
        last = messages[-1]
        last = {**last, "content": last["content"] + "PDF TEXT"}
        messages[-1] = last
        self.assertEqual(messages[1]["content"], "")  # streaming bubble stayed empty
        self.assertIn("PDF TEXT", messages[2]["content"])


if __name__ == "__main__":
    unittest.main()
