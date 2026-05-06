from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timedelta, timezone
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


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _is_recent_iso(ts: str | None, days: int) -> bool:
    if not ts:
        return False
    try:
        s = ts.replace(" ", "T")
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt >= (_now_utc() - timedelta(days=days))
    except Exception:
        return False


class ObservationEngine:
    def __init__(self) -> None:
        self.base_url = _env("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
        self.model = _env("OLLAMA_MODEL", "qwen2.5:32b")

    async def generate_observations(
        self,
        profile: dict[str, Any] | None,
        events: list[dict[str, Any]],
        facts: list[dict[str, Any]],
        projects: list[dict[str, Any]],
        confirmed_hypotheses: list[dict[str, Any]],
        cross_sphere_insights: list[dict[str, Any]],
        spending_periods: dict[str, Any],
    ) -> list[dict[str, Any]]:
        prompt = (
            "You are AIR4 — a proactive personal advisor. You notice things the user hasn't asked about.\n\n"
            f"User: {json.dumps(profile or {}, ensure_ascii=False)}\n"
            f"Recent events: {json.dumps(events or [], ensure_ascii=False)}\n"
            f"Known facts: {json.dumps(facts or [], ensure_ascii=False)}\n"
            f"Active projects: {json.dumps(projects or [], ensure_ascii=False)}\n"
            f"Confirmed patterns: {json.dumps(confirmed_hypotheses or [], ensure_ascii=False)}\n"
            f"Cross-sphere connections: {json.dumps(cross_sphere_insights or [], ensure_ascii=False)}\n"
            f"Spending data: {json.dumps(spending_periods or {}, ensure_ascii=False)}\n\n"
            "Generate 1-2 proactive observations that are:\n"
            "- Non-obvious (not things the user already knows)\n"
            "- Actionable (suggest something concrete)\n"
            "- Timely (relevant right now)\n"
            "- Based on actual data\n\n"
            "Types:\n"
            "- pattern: recurring behavior worth noting\n"
            "- anomaly: something unusual that needs attention\n"
            "- milestone: positive achievement worth celebrating\n"
            "- reminder: something the user might have forgotten\n\n"
            "Return JSON array:\n"
            "[{\n"
            "  'title': 'short title in Russian (max 8 words)',\n"
            "  'body': 'observation in Russian (2-3 sentences, specific numbers)',\n"
            "  'observation_type': 'pattern|anomaly|milestone|reminder'\n"
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
            logger.error("Observation generation failed: %r", e, exc_info=True)
            return []

        out: list[dict[str, Any]] = []
        for el in _parse_json_array(raw)[:2]:
            if not isinstance(el, dict):
                continue
            title = str(el.get("title") or "").strip()
            body = str(el.get("body") or "").strip()
            typ = str(el.get("observation_type") or "pattern").strip().lower()
            if not title or not body:
                continue
            if typ not in ("pattern", "anomaly", "milestone", "reminder"):
                typ = "pattern"
            out.append({"title": title, "body": body, "observation_type": typ})
        return out

