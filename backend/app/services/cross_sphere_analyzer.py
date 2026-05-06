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


def hours_since_iso(ts: str | None) -> float | None:
    if not ts:
        return None
    try:
        s = ts.replace(" ", "T")
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        return (now - dt).total_seconds() / 3600.0
    except Exception:
        return None


class CrossSphereAnalyzer:
    def __init__(self) -> None:
        self.base_url = _env("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
        self.model = _env("OLLAMA_MODEL", "qwen2.5:32b")

    async def analyze_connections(
        self,
        profile: dict[str, Any] | None,
        events: list[dict[str, Any]],
        facts: list[dict[str, Any]],
        projects: list[dict[str, Any]],
        confirmed_hypotheses: list[dict[str, Any]],
        spending_periods: dict[str, Any],
    ) -> list[dict[str, Any]]:
        prompt = (
            "You are AIR4 analyzing connections between different spheres of a person's life.\n\n"
            f"User: {json.dumps(profile or {}, ensure_ascii=False)}\n"
            f"Life events (with dates): {json.dumps(events or [], ensure_ascii=False)}\n"
            f"Known facts: {json.dumps(facts or [], ensure_ascii=False)}\n"
            f"Active projects: {json.dumps(projects or [], ensure_ascii=False)}\n"
            f"Confirmed patterns: {json.dumps(confirmed_hypotheses or [], ensure_ascii=False)}\n"
            f"Spending periods: {json.dumps(spending_periods or {}, ensure_ascii=False)}\n\n"
            "Find 2-3 non-obvious connections between:\n"
            "- Life events and spending changes\n"
            "- Project activity and spending patterns\n"
            "- Life events and project activity\n"
            "- Any other cross-sphere patterns\n\n"
            "Each connection must:\n"
            "- Reference specific dates and amounts\n"
            "- Be based on actual data\n"
            "- Explain the likely cause\n\n"
            "Return JSON array:\n"
            "[{\n"
            "  'sphere1': 'finance|life|projects|health',\n"
            "  'sphere2': 'finance|life|projects|health',\n"
            "  'title': 'short title in Russian',\n"
            "  'description': 'detailed explanation with specific numbers in Russian',\n"
            "  'confidence': 'high|medium|low'\n"
            "}]\n\n"
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
            logger.error("Cross-sphere analysis failed: %r", e, exc_info=True)
            return []

        out: list[dict[str, Any]] = []
        for el in _parse_json_array(raw)[:3]:
            if not isinstance(el, dict):
                continue
            sphere1 = str(el.get("sphere1") or "").strip().lower()
            sphere2 = str(el.get("sphere2") or "").strip().lower()
            title = str(el.get("title") or "").strip()
            desc = str(el.get("description") or "").strip()
            conf = str(el.get("confidence") or "").strip().lower()
            if not title or not desc:
                continue
            if sphere1 not in ("finance", "life", "projects", "health"):
                sphere1 = "finance"
            if sphere2 not in ("finance", "life", "projects", "health"):
                sphere2 = "life"
            if conf not in ("high", "medium", "low"):
                conf = "medium"
            out.append(
                {
                    "sphere1": sphere1,
                    "sphere2": sphere2,
                    "title": title,
                    "description": desc,
                    "confidence": conf,
                }
            )
        return out

