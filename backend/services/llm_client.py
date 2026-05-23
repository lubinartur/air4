from __future__ import annotations

import os
from collections.abc import Iterator
from typing import Any

import anthropic
from dotenv import load_dotenv

load_dotenv()

client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))


def chat(
    messages: list[dict[str, str]],
    system: str,
    model: str = "claude-sonnet-4-5",
    max_tokens: int = 1024,
) -> str:
    response = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system,
        messages=messages,
    )
    return response.content[0].text


def chat_stream(
    messages: list[dict[str, str]],
    system: str,
    model: str = "claude-sonnet-4-5",
    max_tokens: int = 1024,
) -> Iterator[str]:
    with client.messages.stream(
        model=model,
        max_tokens=max_tokens,
        system=system,
        messages=messages,
    ) as stream:
        yield from stream.text_stream


def parse_json_array(text: str) -> list[Any]:
    import json

    s = (text or "").strip()
    try:
        value = json.loads(s)
        return value if isinstance(value, list) else []
    except json.JSONDecodeError:
        start = s.find("[")
        end = s.rfind("]")
        if start != -1 and end != -1 and end > start:
            try:
                value = json.loads(s[start : end + 1])
                return value if isinstance(value, list) else []
            except json.JSONDecodeError:
                return []
        return []


def parse_json_object(text: str) -> dict[str, Any]:
    """Mirror of `parse_json_array` for single-object extractions.

    Tolerates models that wrap JSON in prose / markdown by falling
    back to a `{...}` substring slice. Returns an empty dict when
    nothing parseable is found — callers should treat that as
    "no extraction happened" rather than as an error.
    """
    import json

    s = (text or "").strip()
    try:
        value = json.loads(s)
        return value if isinstance(value, dict) else {}
    except json.JSONDecodeError:
        start = s.find("{")
        end = s.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                value = json.loads(s[start : end + 1])
                return value if isinstance(value, dict) else {}
            except json.JSONDecodeError:
                return {}
        return {}
