from __future__ import annotations

import json
import logging
import os
from typing import Any

import httpx

from app.models.transaction import InsightOut

logger = logging.getLogger(__name__)

_CATEGORY_DISPLAY: dict[str, str] = {
    "food_groceries": "Groceries",
    "food_restaurants": "Restaurants",
    "transport": "Transport",
    "entertainment": "Entertainment",
    "health": "Health",
    "subscriptions": "Subscriptions",
    "shopping": "Shopping",
    "transfers": "Transfers",
    "utilities": "Utilities",
    "other": "Other",
}


def _transaction_category_label(category: object) -> str:
    key = str(category or "").strip()
    return _CATEGORY_DISPLAY.get(key, key or "Other")


def _format_transactions_for_prompt(rows: list[dict[str, Any]], limit: int = 100) -> str:
    lines: list[str] = []
    for t in (rows or [])[:limit]:
        date_s = str(t.get("date") or "").strip()
        desc = str(t.get("description") or "").replace("\n", " ").strip()
        try:
            amt = float(t.get("amount") or 0.0)
        except (TypeError, ValueError):
            amt = 0.0
        cat = _transaction_category_label(t.get("category"))
        lines.append(f"{date_s} | {desc} | €{amt:.2f} | {cat}")
    return "\n".join(lines)


def _env(name: str, default: str) -> str:
    v = os.environ.get(name)
    return v if v is not None and v.strip() else default


# Longer timeout only for insight generation (large model + JSON output).
_INSIGHTS_HTTP_TIMEOUT_S = 300.0
# Monthly report uses the main model (qwen2.5:32b) with full context.
_REPORT_HTTP_TIMEOUT_S = 300.0
# Classification uses the fast model only; keep bounded so chat does not hang.
_CLASSIFY_HTTP_TIMEOUT_S = 90.0


def _format_user_profile_for_prompt(profile: dict[str, Any]) -> str | None:
    lines: list[str] = []
    n = profile.get("name")
    if n is not None and str(n).strip():
        lines.append(f"- Имя: {str(n).strip()}")
    city = profile.get("city")
    if city is not None and str(city).strip():
        lines.append(f"- Город: {str(city).strip()}")
    prof = profile.get("profession")
    if prof is not None and str(prof).strip():
        lines.append(f"- Профессия: {str(prof).strip()}")
    mi = profile.get("monthly_income")
    if mi is not None:
        try:
            v = float(mi)
            lines.append(f"- Доход в месяц: ~€{v:.2f}")
        except (TypeError, ValueError):
            pass
    goals = profile.get("goals")
    if goals is not None and str(goals).strip():
        lines.append(f"- Цели: {str(goals).strip()}")
    trans = profile.get("transport")
    if trans is not None and str(trans).strip():
        lines.append(f"- Транспорт: {str(trans).strip()}")
    ctx = profile.get("context")
    if ctx is not None and str(ctx).strip():
        lines.append(f"- О себе: {str(ctx).strip()}")
    if not lines:
        return None
    return "Профиль пользователя:\n" + "\n".join(lines)


def _parse_complexity_label(raw: str) -> str:
    """Normalize classifier output to SIMPLE or COMPLEX."""
    line = (raw or "").splitlines()[0].strip().upper()
    parts = line.replace(":", " ").split()
    tag = parts[0] if parts else ""
    if tag == "SIMPLE":
        return "SIMPLE"
    if tag == "COMPLEX":
        return "COMPLEX"
    if "SIMPLE" in line and "COMPLEX" not in line:
        return "SIMPLE"
    return "COMPLEX"


class OllamaAnalyzer:
    def __init__(self) -> None:
        self.base_url = _env("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
        self.model = _env("OLLAMA_MODEL", "qwen2.5:32b")
        self.fast_model = _env("OLLAMA_FAST_MODEL", "llama3.1:8b")
        self.timeout_s = float(_env("OLLAMA_TIMEOUT_SECONDS", "180"))

    async def classify_query(self, message: str) -> str:
        """
        Classify user message as SIMPLE (factual / lookup) or COMPLEX (analysis / advice).
        Uses the fast model only. On any failure returns COMPLEX.
        """
        system = (
            "Classify this query as SIMPLE or COMPLEX. "
            "SIMPLE = factual lookup or single number. "
            "COMPLEX = analysis, advice, patterns, explanations. "
            "Reply with only one word: SIMPLE or COMPLEX. "
            "Use English for your reply only."
        )
        user_text = (message or "").strip() or "."
        payload: dict[str, Any] = {
            "model": self.fast_model,
            "temperature": 0,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user_text},
            ],
            "stream": False,
        }
        try:
            async with httpx.AsyncClient(timeout=_CLASSIFY_HTTP_TIMEOUT_S) as client:
                r = await client.post(f"{self.base_url}/api/chat", json=payload)
                r.raise_for_status()
                content = str(r.json()["message"]["content"])
            return _parse_complexity_label(content)
        except Exception:
            logger.warning(
                "classify_query failed, falling back to COMPLEX",
                exc_info=True,
            )
            return "COMPLEX"

    async def generate_insights(self, compact: dict[str, Any]) -> list[InsightOut]:
        """
        compact: {"total_spent_eur": float, "top_categories": [{"category": str, "amount": float}, ...]}
        Only top 5 categories are sent to keep the request small and fast.
        """
        system = (
            "IMPORTANT: Respond in Russian language only. Never use any other language. No exceptions.\n\n"
            "Formatting rules:\n"
            "- Never use markdown: no **, no *, no #, no bullet points with -\n"
            "- Use plain text only\n"
            "- For lists use: 1. 2. 3. or just new lines\n"
            "- For emphasis use CAPS sparingly\n"
            "- Keep responses concise, max 5-6 sentences unless complex analysis needed\n"
            "- Use line breaks between paragraphs\n\n"
            "You are AIR4 — a brutally honest personal finance advisor. "
            "You speak directly, use exact numbers, and never give generic advice.\n\n"
            "Rules:\n"
            "- Currency is always EUR, never dollars\n"
            "- Be specific: name exact categories and amounts\n"
            "- Find patterns that are non-obvious\n"
            "- Don't say 'consider reducing' — say exactly what to cut and by how much\n"
            "- Respond in Russian only\n\n"
            "Return ONLY JSON array with exactly 3 objects:\n"
            '{ "type": string, "title": string, "description": string, "amount_mentioned": number|null }\n'
            "No markdown, no extra text."
        )
        user = (
            "Spending snapshot (EUR only):\n"
            + json.dumps(compact, ensure_ascii=False)
        )
        payload = {
            "model": self.fast_model,
            "temperature": 0.2,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "stream": False,
        }
        try:
            async with httpx.AsyncClient(timeout=_INSIGHTS_HTTP_TIMEOUT_S) as client:
                r = await client.post(f"{self.base_url}/api/chat", json=payload)
                r.raise_for_status()
                content = str(r.json()["message"]["content"])
        except Exception as e:
            err_parts = [repr(e)]
            if isinstance(e, httpx.HTTPStatusError) and e.response is not None:
                try:
                    err_parts.append(f"response_body={e.response.text!r}")
                except Exception:
                    err_parts.append("response_body=<unreadable>")
            logger.error(
                "Ollama insight generation failed: %s",
                " | ".join(err_parts),
                exc_info=True,
            )
            return []

        parsed = _parse_json_array(content)
        insights: list[InsightOut] = []
        for item in parsed[:3]:
            if not isinstance(item, dict):
                continue
            insights.append(
                InsightOut(
                    type=str(item.get("type") or "insight"),
                    title=str(item.get("title") or "").strip() or "Insight",
                    description=str(item.get("description") or "").strip(),
                    amount_mentioned=_to_float_or_none(item.get("amount_mentioned")),
                )
            )
        return insights

    async def chat(
        self,
        message: str,
        history: list[dict[str, Any]],
        summary: dict[str, Any],
        events: list[dict[str, Any]] | None = None,
        profile: dict[str, Any] | None = None,
        transactions: list[dict[str, Any]] | None = None,
        user_facts: list[dict[str, Any]] | None = None,
        projects: list[dict[str, Any]] | None = None,
        confirmed_hypotheses: list[dict[str, Any]] | None = None,
        cross_sphere_insights: list[dict[str, Any]] | None = None,
        interview_answers: list[dict[str, Any]] | None = None,
        current_page: str | None = None,
    ) -> str:
        complexity = await self.classify_query(message)
        chat_model = self.fast_model if complexity == "SIMPLE" else self.model
        logger.info("Query classified as %s, using %s", complexity, chat_model)

        system = (
            "Ты — AIR4. Персональный советник, аналитик и компаньон пользователя.\n\n"
            "Ты давно знаешь этого человека. Ты видел его траты, его проекты, его решения — хорошие и плохие. "
            "Ты не начинаешь с нуля каждый раз.\n\n"
            "КТО ТЫ\n\n"
            "Ты не чат-бот поддержки. Не коуч. Не психолог. Не корпоративный AI.\n\n"
            "Ты умный, спокойный аналитик который говорит как есть — без лишних слов, без шаблонной мотивации, "
            "без попыток понравиться. Ты помогаешь разобраться в ситуации и принять решение.\n\n"
            "Ты инвестирован в этого человека. Ты следишь за его историей. Тебе не всё равно — но ты не сюсюкаешься.\n\n"
            "КАК ТЫ ГОВОРИШЬ\n\n"
            "— На 'ты'. Всегда.\n"
            "— Коротко и точно. Без воды.\n"
            "— Без извинений. Ты не говоришь 'извини если это звучит резко' или 'я могу ошибаться но...'. "
            "Ты говоришь что видишь и стоишь за этим.\n"
            "— Без шаблонной мотивации. Никогда: 'ты справишься!', 'главное не сдаваться', 'каждый день — это прогресс'.\n"
            "— Имя пользователя — редко. Только для акцента в важный момент.\n"
            "— Ирония и жёсткость — только когда заслужено контекстом. Не для образа.\n\n"
            "Плохо: 'Ты опять всё просрал.'\n"
            "Хорошо: 'Ты сейчас снова распыляешься на 4 направления. В прошлый раз это закончилось тем, "
            "что ты не закончил ни одно.'\n\n"
            "ЧТО ТЫ ДЕЛАЕШЬ\n\n"
            "Ты помогаешь справиться. Не анализируешь ради анализа.\n\n"
            "Практически — находишь решения, говоришь конкретно что делать с цифрами и фактами.\n"
            "Эмоционально — замечаешь когда что-то идёт не так, спрашиваешь один раз, не давишь.\n"
            "Стратегически — раскладываешь дилеммы и решения с учётом реального контекста этого человека.\n\n"
            "Ты читаешь косвенные сигналы. Паттерны в тратах, активности, проектах. Не ставишь диагнозы — "
            "говоришь что видишь и спрашиваешь.\n\n"
            "КОГДА МОЛЧАТЬ\n\n"
            "Если нет сильного наблюдения — не придумывай активность.\n"
            "Скажи прямо: 'Пока всё идёт ровно. Сильных наблюдений сейчас нет.'\n\n"
            "Ты говоришь когда есть что сказать. Именно поэтому когда говоришь — тебя слушают.\n\n"
            "ПАМЯТЬ И КОНТЕКСТ\n\n"
            "Ты используешь всё что знаешь об этом человеке: его профиль, события, факты, историю разговоров, "
            "финансовые данные.\n\n"
            "Твои наблюдения становятся глубже со временем. В первые дни ты не делаешь далеко идущих выводов — "
            "у тебя ещё нет истории. Тон становится плотнее по мере того как накапливается контекст.\n\n"
            "Ты не прогибаешься от давления. Если пользователь не согласен — ты слушаешь и пересматриваешь позицию "
            "если есть аргумент. Не потому что на тебя давят.\n\n"
            "ФОРМАТИРОВАНИЕ\n\n"
            "— Никакого markdown: нет **, нет *, нет #\n"
            "— Только plain text\n"
            "— Для списков: 1. 2. 3. или новые строки\n"
            "— Коротко. Максимум 4-5 предложений если не просят развернуть.\n"
            "— Язык: русский. Всегда.\n"
        )
        system_content = system
        page = (current_page or "").strip()
        if page:
            system_content += f"\n\nПользователь сейчас на странице: {page}."
        if profile:
            profile_block = _format_user_profile_for_prompt(profile)
            if profile_block:
                system_content += f"\n\n{profile_block}"
        context = "Сводка трат (JSON):\n" + json.dumps(summary, ensure_ascii=False)
        system_content = system_content + "\n\n" + context
        if transactions:
            compact = _format_transactions_for_prompt(transactions, limit=100)
            if compact:
                system_content += (
                    "\n\nНедавние транзакции (дата, описание, сумма, категория):\n"
                    + compact
                )
        if events:
            system_content += (
                "\n\nСобытия из жизни пользователя (память; используй когда уместно):\n"
                + json.dumps(events, ensure_ascii=False)
            )
        if user_facts:
            fact_lines = [
                f"{str(f.get('key') or '').strip()}: {str(f.get('value') or '').strip()}"
                for f in user_facts
                if (f.get("key") or "").strip() and (f.get("value") or "").strip()
            ]
            if fact_lines:
                system_content += "\n\nФакты о пользователе:\n" + "\n".join(fact_lines)
        if projects:
            lines: list[str] = []
            for idx, p in enumerate(projects[:20], start=1):
                name = str(p.get("name") or "").strip()
                if not name:
                    continue
                desc = str(p.get("description") or "").replace("\n", " ").strip()
                status = str(p.get("status") or "").strip()
                extra = f" — {desc}" if desc else ""
                tail = f" ({status})" if status else ""
                lines.append(f"{idx}. {name}{extra}{tail}")
            if lines:
                system_content += "\n\nАктивные проекты:\n" + "\n".join(lines)
        if confirmed_hypotheses:
            lines: list[str] = []
            for idx, h in enumerate(confirmed_hypotheses[:20], start=1):
                text = str(h.get("text") or "").replace("\n", " ").strip()
                if not text:
                    continue
                lines.append(f"{idx}. {text}")
            if lines:
                system_content += "\n\nПодтверждённые паттерны:\n" + "\n".join(lines)
        if cross_sphere_insights:
            lines: list[str] = []
            for idx, ins in enumerate(cross_sphere_insights[:10], start=1):
                title = str(ins.get("title") or "").replace("\n", " ").strip()
                desc = str(ins.get("description") or "").replace("\n", " ").strip()
                if not title or not desc:
                    continue
                lines.append(f"{idx}. {title}: {desc}")
            if lines:
                system_content += "\n\nМежсферные связи:\n" + "\n".join(lines)
        if interview_answers:
            lines: list[str] = []
            for qa in interview_answers[:50]:
                q = str(qa.get("question") or "").replace("\n", " ").strip()
                a = str(qa.get("answer") or "").strip()
                if not q or not a:
                    continue
                lines.append(f"Q: {q}\nA: {a}")
            if lines:
                system_content += "\n\nОтветы из интервью:\n" + "\n\n".join(lines)
        messages: list[dict[str, Any]] = [{"role": "system", "content": system_content}]
        for m in history[-20:]:
            role = m.get("role")
            content = m.get("content")
            if role in ("user", "assistant") and isinstance(content, str):
                messages.append({"role": role, "content": content})
        messages.append({"role": "user", "content": message})

        payload = {
            "model": chat_model,
            "temperature": 0.3,
            "messages": messages,
            "stream": False,
        }
        try:
            async with httpx.AsyncClient(timeout=self.timeout_s) as client:
                r = await client.post(f"{self.base_url}/api/chat", json=payload)
                r.raise_for_status()
                return str(r.json()["message"]["content"]).strip()
        except (httpx.HTTPError, KeyError, TypeError, ValueError):
            return "I couldn't reach Ollama right now. Please ensure it's running and try again."

    async def generate_monthly_report(
        self,
        name: str,
        period_start: str | None,
        period_end: str | None,
        total_spent: float,
        by_category: list[dict[str, Any]],
        top_transaction_rows: list[dict[str, Any]],
        events: list[dict[str, Any]],
        facts: list[dict[str, Any]],
        profile: dict[str, Any],
    ) -> str:
        """Plain-text monthly report; uses main Ollama model (qwen2.5:32b by default)."""
        categories_line = json.dumps(by_category, ensure_ascii=False)
        top_tx_block = _format_transactions_for_prompt(top_transaction_rows, limit=20)
        if not top_tx_block.strip():
            top_tx_block = "(none)"
        events_line = json.dumps(events, ensure_ascii=False)
        facts_line = json.dumps(facts, ensure_ascii=False)
        profile_line = _format_user_profile_for_prompt(profile)
        if not profile_line:
            profile_line = "(no profile details)"

        ps = period_start or "—"
        pe = period_end or "—"
        user_content = (
            f"You are AIR4 — a personal life advisor, not just a finance tool. "
            f"Write a monthly life report for {name}.\n\n"
            "Data:\n"
            f"- Period: {ps} — {pe}\n"
            f"- Spending total: €{total_spent:.2f}\n"
            f"- Spending by category: {categories_line}\n"
            f"- Top transactions:\n{top_tx_block}\n"
            f"- Life events this period: {events_line}\n"
            f"- Facts about the user: {facts_line}\n"
            f"- Profile: {profile_line}\n\n"
            "Write a 4-5 paragraph personal report:\n"
            "1. Life overview this period — what happened, key events\n"
            "2. Financial picture — where money went, key patterns\n"
            "3. Connections — how life events relate to spending "
            "(stress → food delivery, gym → health costs, no car → Bolt)\n"
            "4. What stands out — one non-obvious observation\n"
            "5. 2-3 concrete next steps\n\n"
            "Tone: honest, direct, like a smart friend who knows you well. Not corporate. Use exact numbers.\n"
            "Respond in Russian if the user's profile is in Russian."
        )
        payload: dict[str, Any] = {
            "model": self.model,
            "temperature": 0.3,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "IMPORTANT: Write the entire report in Russian language only. Never use any other language. "
                        "No exceptions.\n\n"
                        "Formatting rules:\n"
                        "- Never use markdown: no **, no *, no #, no bullet points with -\n"
                        "- Use plain text only\n"
                        "- For lists use: 1. 2. 3. or just new lines\n"
                        "- For emphasis use CAPS sparingly\n"
                        "- Keep responses concise, max 5-6 sentences unless complex analysis needed\n"
                        "- Use line breaks between paragraphs\n\n"
                        "You are AIR4 — a personal life advisor who sees the full picture of life and money. "
                        "Follow the user's instructions precisely."
                    ),
                },
                {"role": "user", "content": user_content},
            ],
            "stream": False,
        }
        try:
            async with httpx.AsyncClient(timeout=_REPORT_HTTP_TIMEOUT_S) as client:
                r = await client.post(f"{self.base_url}/api/chat", json=payload)
                r.raise_for_status()
                return str(r.json()["message"]["content"]).strip()
        except Exception as e:
            logger.error("Ollama monthly report failed: %r", e, exc_info=True)
            return (
                "Could not generate the report. Ensure Ollama is running with model "
                f"{self.model!r} and try again."
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


def _to_float_or_none(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None
