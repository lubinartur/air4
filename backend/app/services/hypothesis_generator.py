from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_HTTP_TIMEOUT_S = 300.0


def _env(name: str, default: str) -> str:
    v = os.environ.get(name)
    return v if v is not None and v.strip() else default


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


class HypothesisGenerator:
    def __init__(self) -> None:
        self.base_url = _env("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
        self.model = _env("OLLAMA_MODEL", "qwen2.5:32b")

    async def generate(
        self,
        profile: dict[str, Any] | None,
        spending_summary: dict[str, Any],
        events: list[dict[str, Any]],
        facts: list[dict[str, Any]],
        projects: list[dict[str, Any]],
    ) -> list[str]:
        prompt = (
            "You are AIR4 analyzing patterns in a person's life.\n\n"
            f"User profile: {json.dumps(profile or {}, ensure_ascii=False)}\n"
            f"Spending data: {json.dumps(spending_summary or {}, ensure_ascii=False)}\n"
            f"Life events: {json.dumps(events or [], ensure_ascii=False)}\n"
            f"Known facts: {json.dumps(facts or [], ensure_ascii=False)}\n"
            f"Active projects: {json.dumps(projects or [], ensure_ascii=False)}\n\n"
            "Generate 1-2 non-obvious hypotheses about this person's behavior or patterns.\n"
            "Each hypothesis should be:\n"
            "- Specific and verifiable\n"
            "- Based on actual data patterns\n"
            "- Phrased as a question the user can confirm or reject\n\n"
            "Return JSON array:\n"
            "[{ 'text': 'hypothesis as a question in Russian' }]\n\n"
            "No markdown. JSON only. In Russian."
        )

        system = (
            "IMPORTANT: Respond in Russian language only. Never use any other language. No exceptions.\n"
            "IMPORTANT: Never use markdown. JSON only.\n"
            "Return only valid JSON array, nothing else."
        )
        payload: dict[str, Any] = {
            "model": self.model,
            "temperature": 0.3,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            "stream": False,
        }
        try:
            async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_S) as client:
                r = await client.post(f"{self.base_url}/api/chat", json=payload)
                r.raise_for_status()
                raw = str(r.json()["message"]["content"])
        except Exception as e:
            logger.error("Hypothesis generation failed: %r", e, exc_info=True)
            return []

        out: list[str] = []
        for el in _parse_json_array(raw)[:2]:
            if not isinstance(el, dict):
                continue
            text = str(el.get("text") or "").strip()
            if not text:
                continue
            out.append(text)
        return out


def hours_since_iso(ts: str | None) -> float | None:
    if not ts:
        return None
    try:
        # SQLite CURRENT_TIMESTAMP: "YYYY-MM-DD HH:MM:SS"
        s = ts.replace(" ", "T")
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        return (now - dt).total_seconds() / 3600.0
    except Exception:
        return None

