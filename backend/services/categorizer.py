from __future__ import annotations

import json

from services.llm_client import chat, parse_json_array
from services.parser import TransactionIn

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
    "salary",
    "other",
]

_SYSTEM = (
    "You are a precise transaction categorizer for Estonian bank statements (Swedbank).\n"
    "Common Estonian merchants: Rimi, Maxima, Prisma = food_groceries; "
    "Bolt, Taxify, Uber = transport; Wolt, Bolt Food = food_restaurants; "
    "Telia, Elisa, Tele2 = subscriptions; Enefit = utilities.\n"
    "Estonian finance terms:\n"
    "- Laenu põhiosa = loan repayment → transfers\n"
    "- Kogunenud intress = interest → transfers\n"
    "- Ülekanne / Ulekanne = bank transfer → transfers\n"
    "- Kindlustusmakse = insurance → health or utilities\n"
    "- Kommunaalkulud = utilities → utilities\n"
    "- Salary / palk / töötasu = salary\n"
    f"Choose exactly one category per transaction from: {', '.join(CATEGORIES)}\n\n"
    "Rules:\n"
    "- Return ONLY a JSON array of strings.\n"
    "- No markdown, no explanation.\n"
    "- Array length must equal number of transactions.\n"
)


def categorize(transactions: list[TransactionIn]) -> list[str]:
    if not transactions:
        return []

    results: list[str] = []
    for i in range(0, len(transactions), 20):
        batch = transactions[i : i + 20]
        results.extend(_categorize_batch(batch))
    return results


def _categorize_batch(batch: list[TransactionIn]) -> list[str]:
    items = [
        {
            "date": t.date.isoformat(),
            "description": t.description,
            "amount": t.amount,
            "is_debit": t.is_debit,
        }
        for t in batch
    ]
    user = "Categorize these transactions. Output JSON array only.\n\n" + json.dumps(
        items, ensure_ascii=False
    )
    try:
        content = chat(
            messages=[{"role": "user", "content": user}],
            system=_SYSTEM,
            max_tokens=2048,
        )
    except Exception:
        return ["other"] * len(batch)

    parsed = parse_json_array(content)
    out: list[str] = []
    for cat in parsed:
        key = str(cat).strip()
        out.append(key if key in CATEGORIES else "other")
    if len(out) != len(batch):
        return ["other"] * len(batch)
    return out
