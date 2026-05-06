from __future__ import annotations

import json
import logging
import os
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


class Interviewer:
    def __init__(self) -> None:
        self.base_url = _env("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
        self.model = _env("OLLAMA_MODEL", "qwen2.5:32b")

    async def generate_questions(
        self,
        profile: dict[str, Any] | None,
        facts: list[dict[str, Any]] | None,
        events: list[dict[str, Any]] | None,
        projects: list[dict[str, Any]] | None,
        existing_answers: list[dict[str, Any]] | None,
    ) -> list[str]:
        system = (
            "Ты — AIR4. Ты хочешь лучше понять этого человека чтобы давать более точные советы.\n\n"
            "No markdown. JSON only. In Russian.\n"
            "Return ONLY JSON array: [{\"question\":\"...\"}]\n"
        )
        user = (
            "Что ты уже знаешь:\n"
            f"Профиль: {json.dumps(profile or {}, ensure_ascii=False)}\n"
            f"Факты: {json.dumps(facts or [], ensure_ascii=False)}\n"
            f"События: {json.dumps(events or [], ensure_ascii=False)}\n"
            f"Проекты: {json.dumps(projects or [], ensure_ascii=False)}\n"
            f"Предыдущие ответы: {json.dumps(existing_answers or [], ensure_ascii=False)}\n\n"
            "Придумай 3 вопроса которые:\n"
            "- Заполнят реальные пробелы в твоём понимании этого человека\n"
            "- Не повторяют то что уже известно\n"
            "- Конкретные, не абстрактные\n"
            "- Помогут лучше анализировать финансы, проекты или жизненные решения\n\n"
            "Примеры хороших вопросов:\n"
            "- Ты работаешь фрилансером или в найме? Доход стабильный или скачет?\n"
            "- Есть ли у тебя финансовая цель на этот год — конкретная сумма или покупка?\n"
            "- Ты сейчас в найме параллельно с TartuPak или это единственный источник дохода?\n\n"
            "Return JSON array:\n"
            "[{ 'question': 'вопрос на русском' }]\n\n"
            "No markdown. JSON only. In Russian."
        )

        payload: dict[str, Any] = {
            "model": self.model,
            "temperature": 0.3,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "stream": False,
        }

        try:
            async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_S) as client:
                r = await client.post(f"{self.base_url}/api/chat", json=payload)
                r.raise_for_status()
                content = str(r.json()["message"]["content"] or "").strip()
        except Exception as e:
            logger.error("Interview questions generation failed: %r", e, exc_info=True)
            return []

        out: list[str] = []
        for item in _parse_json_array(content):
            if not isinstance(item, dict):
                continue
            q = str(item.get("question") or "").strip()
            if q:
                out.append(q)
            if len(out) >= 3:
                break
        return out[:3]

