from __future__ import annotations

import json
import os
from typing import Any

import httpx

from app.models.transaction import Category, TransactionIn


CATEGORIES: list[str] = [
    "food_groceries",
    "food_restaurants",
    "transport",
    "entertainment",
    "health",
    "subscriptions",
    "shopping",
    "transfers",
    "utilities",
    "other",
]


def _env(name: str, default: str) -> str:
    v = os.environ.get(name)
    return v if v is not None and v.strip() else default


class OllamaCategorizer:
    def __init__(self) -> None:
        self.base_url = _env("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
        self.model = _env("OLLAMA_MODEL", "qwen2.5:32b")
        self.timeout_s = float(_env("OLLAMA_TIMEOUT_SECONDS", "180"))

    async def categorize(self, txns: list[TransactionIn]) -> list[str]:
        if not txns:
            return []

        results: list[str] = []
        async with httpx.AsyncClient(timeout=self.timeout_s) as client:
            for i in range(0, len(txns), 20):
                batch = txns[i : i + 20]
                categories = await self._categorize_batch(client, batch)
                if len(categories) != len(batch):
                    categories = ["other"] * len(batch)
                results.extend(categories)
        return results

    async def _categorize_batch(
        self, client: httpx.AsyncClient, batch: list[TransactionIn]
    ) -> list[str]:
        items = [
            {
                "date": t.date.isoformat(),
                "description": t.description,
                "amount": t.amount,
                "is_debit": t.is_debit,
            }
            for t in batch
        ]

        system = (
            "You are a precise transaction categorizer for Estonian bank statements.\n"
            "Common Estonian merchants: Rimi, Maxima, Prisma = food_groceries; "
            "Bolt, Taxify, Uber = transport; Wolt, Bolt Food = food_restaurants; "
            "Telia, Elisa, Tele2 = subscriptions; Enefit = utilities.\n"
            "Estonian finance terms:\n"
            "- Laenu põhiosa = loan repayment → transfers\n"
            "- Kogunenud intress = interest payment → transfers\n"
            "- Ülekanne / Ulekanne = bank transfer → transfers\n"
            "- Kindlustusmakse = insurance payment → health or utilities\n"
            "- Kommunaalkulud = utilities → utilities\n"
            "Choose exactly one category per transaction from this list:\n"
            f"{', '.join(CATEGORIES)}\n\n"
            "Rules:\n"
            "- Return ONLY a JSON array of strings.\n"
            "- No markdown, no explanation.\n"
            "- Array length must equal number of transactions.\n"
        )

        user = (
            "Categorize these transactions. Output JSON array only.\n\n"
            + json.dumps(items, ensure_ascii=False)
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
            r = await client.post(f"{self.base_url}/api/chat", json=payload)
            r.raise_for_status()
            data = r.json()
            content = str(data["message"]["content"])
        except (httpx.HTTPError, KeyError, TypeError, ValueError):
            return ["other"] * len(batch)

        parsed = self._parse_json_array(content)
        out: list[str] = []
        for c in parsed:
            c = str(c).strip()
            out.append(c if c in CATEGORIES else "other")
        if len(out) != len(batch):
            return ["other"] * len(batch)
        return out

    def _parse_json_array(self, content: str) -> list[Any]:
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

