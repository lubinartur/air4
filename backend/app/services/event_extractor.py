from __future__ import annotations

import json
import logging
import os
from datetime import date
from typing import Any

import httpx

logger = logging.getLogger(__name__)

EVENT_CATEGORIES = frozenset(
    {"life", "health", "work", "project", "finance", "travel", "other"}
)


def _env(name: str, default: str) -> str:
    v = os.environ.get(name)
    return v if v is not None and v.strip() else default


_EXTRACTOR_TIMEOUT_S = 90.0


class EventExtractor:
    """Uses the fast Ollama model to detect memorable life events in chat text."""

    def __init__(self) -> None:
        self.base_url = _env("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
        self.model = _env("OLLAMA_FAST_MODEL", "llama3.1:8b")

    async def extract_event(self, user_message: str) -> dict[str, str] | None:
        """
        If the message describes a memorable event, returns
        {"title", "date", "category", "description"}.
        Otherwise returns None.
        """
        text = (user_message or "").strip()
        if not text:
            return None

        today_iso = date.today().isoformat()
        system = (
            "You are an event detector. If the user message describes a life event worth "
            "remembering (started gym, launched a project, got sick, moved cities, started a "
            "new job, got promoted, had a child, etc.), extract it.\n"
            "Return JSON only:\n"
            '- If there is a memorable event: {"has_event": true, "title": string, '
            '"date": string (YYYY-MM-DD; use the provided TODAY_DATE if the user did not specify '
            'a date), "category": string, "description": string (one short sentence)}\n'
            '- If there is no such event: {"has_event": false}\n\n'
            "category must be exactly one of: life, health, work, project, finance, travel, other\n"
            "No markdown, no explanation, no extra keys."
        )
        user = (
            f"TODAY_DATE: {today_iso}\n\nUser message:\n{text}"
        )
        payload = {
            "model": self.model,
            "temperature": 0,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "stream": False,
        }
        try:
            async with httpx.AsyncClient(timeout=_EXTRACTOR_TIMEOUT_S) as client:
                r = await client.post(f"{self.base_url}/api/chat", json=payload)
                r.raise_for_status()
                raw = str(r.json()["message"]["content"])
        except Exception as e:
            logger.warning("Event extraction Ollama call failed: %r", e, exc_info=True)
            return None

        data = _parse_json_object(raw)
        has = data.get("has_event")
        if not data or has not in (True, "true", "True", 1, "1"):
            return None

        title = str(data.get("title") or "").strip()
        if not title:
            return None

        cat = str(data.get("category") or "other").strip().lower()
        if cat not in EVENT_CATEGORIES:
            cat = "other"

        event_date = str(data.get("date") or today_iso).strip() or today_iso
        description = str(data.get("description") or title).strip() or title

        return {
            "title": title,
            "date": event_date,
            "category": cat,
            "description": description,
        }


def _parse_json_object(content: str) -> dict[str, Any] | None:
    s = (content or "").strip()
    try:
        v = json.loads(s)
        return v if isinstance(v, dict) else None
    except json.JSONDecodeError:
        start = s.find("{")
        end = s.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                v = json.loads(s[start : end + 1])
                return v if isinstance(v, dict) else None
            except json.JSONDecodeError:
                return None
        return None
