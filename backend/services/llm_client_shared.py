from __future__ import annotations

import os
from typing import Any

import httpx

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
DEFAULT_MODEL = "claude-haiku-4-5-20251001"
DEFAULT_TIMEOUT_S = 90.0


async def call_claude(
    prompt: str,
    *,
    api_key: str | None = None,
    model: str = DEFAULT_MODEL,
    max_tokens: int = 2048,
    temperature: float = 0,
) -> str:
    """Call Anthropic Messages API; returns assistant text or empty string."""
    return await call_claude_content(
        prompt,
        api_key=api_key,
        model=model,
        max_tokens=max_tokens,
        temperature=temperature,
    )


async def call_claude_content(
    content: str | list[dict[str, Any]],
    *,
    api_key: str | None = None,
    model: str = DEFAULT_MODEL,
    max_tokens: int = 2048,
    temperature: float = 0,
) -> str:
    """Call Anthropic Messages API with text or multimodal content blocks."""
    key = (api_key if api_key is not None else os.getenv("ANTHROPIC_API_KEY", "")) or ""
    if not key.strip():
        return ""

    payload = {
        "model": model,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "messages": [{"role": "user", "content": content}],
    }
    headers = {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT_S) as client:
        response = await client.post(ANTHROPIC_URL, json=payload, headers=headers)
        response.raise_for_status()
        data = response.json()

    for block in data.get("content") or []:
        if block.get("type") == "text":
            return str(block.get("text") or "")
    return ""
