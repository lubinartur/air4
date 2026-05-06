from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

import aiosqlite
import httpx

from app.database import execute, fetch_one

logger = logging.getLogger(__name__)


def _env(name: str, default: str) -> str:
    v = os.environ.get(name)
    return v if v is not None and v.strip() else default


_EXTRACTOR_TIMEOUT_S = 90.0

_SYSTEM = (
    "You are a fact extractor. Read this conversation message and extract any personal "
    "facts worth remembering about the user (preferences, goals, opinions, habits, "
    "explanations of transactions).\n"
    "Return JSON array: [{\"key\": string, \"value\": string}]\n"
    "Or return: []\n"
    "Extract facts in Russian. Key in snake_case English, value in Russian.\n"
    "Keys should be short snake_case. Values should be concise sentences.\n"
    "No markdown, JSON only."
)


def _parse_json_array(content: str) -> list[Any]:
    s = (content or "").strip()
    try:
        v = json.loads(s)
        return v if isinstance(v, list) else []
    except json.JSONDecodeError:
        start = s.find("[")
        end = s.rfind("]")
        if start != -1 and end != -1 and end > start:
            try:
                v = json.loads(s[start : end + 1])
                return v if isinstance(v, list) else []
            except json.JSONDecodeError:
                return []
        return []


def _normalize_key(raw: str) -> str | None:
    s = (raw or "").strip().lower().replace(" ", "_")
    s = re.sub(r"[^a-z0-9_]+", "_", s)
    s = re.sub(r"_+", "_", s).strip("_")
    if not s or len(s) > 80:
        return None
    return s


class FactExtractor:
    """Uses the fast Ollama model to extract storable user facts from chat."""

    def __init__(self) -> None:
        self.base_url = _env("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
        self.model = _env("OLLAMA_FAST_MODEL", "llama3.1:8b")

    async def extract_facts(self, user_message: str) -> list[dict[str, str]]:
        text = (user_message or "").strip()
        if not text:
            return []

        payload = {
            "model": self.model,
            "temperature": 0,
            "messages": [
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": text},
            ],
            "stream": False,
        }
        try:
            async with httpx.AsyncClient(timeout=_EXTRACTOR_TIMEOUT_S) as client:
                r = await client.post(f"{self.base_url}/api/chat", json=payload)
                r.raise_for_status()
                raw = str(r.json()["message"]["content"])
        except Exception as e:
            logger.warning("Fact extraction Ollama call failed: %r", e, exc_info=True)
            return []

        items: list[dict[str, str]] = []
        for el in _parse_json_array(raw):
            if not isinstance(el, dict):
                continue
            nk = _normalize_key(str(el.get("key") or ""))
            val = str(el.get("value") or "").strip()
            if not nk or not val:
                continue
            items.append({"key": nk, "value": val})
        return items

    async def extract_and_save(
        self, db: aiosqlite.Connection, user_message: str
    ) -> list[dict[str, Any]]:
        facts = await self.extract_facts(user_message)
        by_key: dict[str, str] = {}
        for f in facts:
            by_key[f["key"]] = f["value"]
        saved: list[dict[str, Any]] = []
        for key, value in by_key.items():
            await execute(
                db,
                """
                INSERT INTO user_facts (key, value, source)
                VALUES (?, ?, 'chat')
                ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    source = excluded.source,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (key, value),
            )
            row = await fetch_one(
                db, "SELECT * FROM user_facts WHERE key = ?", (key,)
            )
            if row is not None:
                saved.append(dict(row))
        return saved
