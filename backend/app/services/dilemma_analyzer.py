from __future__ import annotations

import logging
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_HTTP_TIMEOUT_S = 300.0


def _env(name: str, default: str) -> str:
    v = os.environ.get(name)
    return v if v is not None and v.strip() else default


class DilemmaAnalyzer:
    def __init__(self) -> None:
        self.base_url = _env("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
        self.model = _env("OLLAMA_MODEL", "qwen2.5:32b")

    async def analyze_dilemma(
        self,
        dilemma_text: str,
        profile: dict[str, Any] | None,
        facts: list[dict[str, Any]] | None,
        events: list[dict[str, Any]] | None,
        projects: list[dict[str, Any]] | None,
        spending_summary: dict[str, Any] | None,
        transactions: list[dict[str, Any]] | None,
    ) -> dict[str, str]:
        # Keep the prompt very explicit: plain text, Russian, no markdown.
        system = (
            "Ты — AIR4. Тебя попросили разобрать дилемму.\n\n"
            "Говори прямо. Используй реальные данные. Без воды.\n"
            "Формат: plain text, никакого markdown.\n"
            "Язык: русский.\n\n"
            "Верни в ответе ровно 3 блока:\n"
            "TITLE: <короткий заголовок>\n"
            "ANALYSIS: <структурированный разбор>\n"
            "RECOMMENDATION: <конкретная рекомендация>\n"
            "Никаких других блоков.\n\n"
            "КРИТИЧНО: используй переносы строк между секциями и внутри секций."
        )

        user = (
            "Контекст пользователя:\n"
            f"Профиль: {profile or {}}\n"
            f"Финансы: {spending_summary or {}}\n"
            f"Факты: {facts or []}\n"
            f"События: {events or []}\n"
            f"Проекты: {projects or []}\n"
            f"Транзакции: {transactions or []}\n\n"
            f"Дилемма: {dilemma_text}\n\n"
            "Разложи эту дилемму структурированно.\n"
            "Используй переносы строк между секциями. Форматируй ТОЧНО так:\n\n"
            "1. СУТЬ ВЫБОРА:\n"
            "[text]\n\n"
            "2. ВАРИАНТЫ:\n"
            "Вариант А: [name]\n"
            "Плюсы: [text]\n"
            "Минусы: [text]\n\n"
            "Вариант Б: [name]\n"
            "Плюсы: [text]\n"
            "Минусы: [text]\n\n"
            "3. КОНТЕКСТ:\n"
            "[text]\n\n"
            "РЕКОМЕНДАЦИЯ:\n"
            "[text]\n"
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
            logger.error("Dilemma analysis failed: %r", e, exc_info=True)
            return {
                "title": "Разбор дилеммы",
                "analysis": "Не удалось получить ответ от Ollama. Проверь, что сервис запущен, и попробуй ещё раз.",
                "recommendation": "Запусти Ollama и повтори запрос.",
            }

        title = ""
        analysis = ""
        recommendation = ""
        for line in content.splitlines():
            if line.startswith("TITLE:"):
                title = line.split("TITLE:", 1)[1].strip()
            elif line.startswith("ANALYSIS:"):
                analysis = line.split("ANALYSIS:", 1)[1].strip()
            elif line.startswith("RECOMMENDATION:"):
                recommendation = line.split("RECOMMENDATION:", 1)[1].strip()
            else:
                # If we're inside a block, append raw lines for multi-line output.
                if recommendation:
                    recommendation += "\n" + line
                elif analysis:
                    analysis += "\n" + line
                elif title:
                    title += " " + line.strip()

        title = title.strip() or "Разбор дилеммы"
        analysis = analysis.strip() or content
        recommendation = recommendation.strip() or ""
        return {"title": title, "analysis": analysis, "recommendation": recommendation}

