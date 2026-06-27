"""Persist obligations when the assistant explicitly confirms one.

The LLM replies in two common shapes:

1. Inline: ``Добавил в обязательства: iPhone (Алиса) — €111/мес, осталось €1335``
2. Multi-line block::

       Добавил в обязательства:

       **iPhone 17 Pro 256GB для Алисы**
       - Сумма: €1335
       - Оплачено: €222.50 (2 платежа по €111.25)
       - Ежемесячный платёж: €111.25

Both must persist a row in `obligations`. This module finds every
trigger phrase, grabs the rest of the surrounding block (until a blank
line or end of text), parses name + amounts, and routes through the
shared ``persist_obligation`` path so chat-source rows look identical
to fact-extractor rows.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from services.fact_extractor import persist_obligation
from services.finance_facts import parse_obligation_amounts

logger = logging.getLogger(__name__)

# Trigger phrases (RU + EN) — case-insensitive. Matched as a multiline
# anchor so the next regex can grab everything after it.
_TRIGGER_RE = re.compile(
    r"("
    r"добавил(?:а|и)?\s+(?:в\s+)?обязательств[аеиоу]?"
    r"|добавлено\s+(?:в\s+)?обязательств[аеиоу]?"
    r"|добавлю\s+(?:в\s+)?обязательств[аеиоу]?"
    r"|записал(?:а|и)?\s+(?:в\s+)?обязательств[аеиоу]?"
    r"|added\s+to\s+obligations?"
    r"|added\s+obligation"
    r"|new\s+obligation"
    r")",
    re.IGNORECASE,
)

# Markdown / bullet noise we strip before parsing the obligation name.
_BULLET_RE = re.compile(r"^[\s\-•*]+")
_MD_BOLD_RE = re.compile(r"\*\*([^*]+)\*\*")


def _strip_markdown(line: str) -> str:
    line = (line or "").strip()
    line = _BULLET_RE.sub("", line)
    return line.strip().strip("*_").strip()


def _name_from_block(block: str) -> str:
    """Pick the obligation name from the block body.

    Priority:
      1. First **bold** span (most LLM templates wrap the name in **).
      2. First non-empty line that doesn't look like a labelled amount.
      3. Inline tail right after the trigger colon.
    """
    bold = _MD_BOLD_RE.search(block)
    if bold:
        candidate = bold.group(1).strip()
        if 2 <= len(candidate) <= 200:
            return candidate

    for raw in block.splitlines():
        line = _strip_markdown(raw)
        if not line:
            continue
        # Skip labelled lines like "Сумма: 1335" / "Оплачено: …".
        if re.match(
            r"^(сумма|оплачено|kuumakse|makstud|monthly|payment|"
            r"остал|осталось|paid|total|principal|итого|период|"
            r"последн|сейчас|до\s+\d|с\s+\d)",
            line,
            re.IGNORECASE,
        ):
            continue
        head = _clean_name(line)
        if 2 <= len(head) <= 200:
            return head

    return "Unnamed"


def _clean_name(raw: str) -> str:
    """Strip amounts / quotes / trailing punctuation from a candidate name."""
    line = (raw or "").strip()
    # Cut at the first description marker (— или запятая со словом-маркером).
    line = re.split(
        r"\s*[—–-]\s*|\s*,\s*(?:осталось|всего|€|EUR|евро|ежемесяч|на\s+сумм)",
        line,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0].strip()
    # Drop trailing amount in any of: "€100/мес.", "€100", "100 евро в месяц",
    # "100/мес". Loop so multiple trailers (e.g. "X €100/мес €50") collapse.
    for _ in range(3):
        new_line = re.sub(
            r"\s*(?:€|EUR|eur|евро)?\s*\d[\d\s.,]*"
            r"(?:\s*(?:€|EUR|eur|евро))?"
            r"(?:\s*(?:/\s*мес\.?|в\s*месяц|ежемесячно|per\s*month|monthly))?"
            r"\s*[.,]?\s*$",
            "",
            line,
            flags=re.IGNORECASE,
        ).strip()
        if new_line == line:
            break
        line = new_line
    # Strip surrounding quotes & whitespace; keep balanced brackets.
    line = line.strip("\"'«»“”‘’ \t,;:.")
    return line


def _extract_block(text: str, trigger_end: int) -> str:
    """Return the obligation body that follows the trigger.

    Captures from `trigger_end` up to the first blank line (≥ 2
    consecutive newlines) or end of text. This lets multi-line replies
    with bullets / labelled fields survive intact.
    """
    tail = text[trigger_end:]
    # Drop an optional leading ":" and whitespace/newlines.
    tail = re.sub(r"^\s*:?\s*", "", tail)
    blank = re.search(r"\n\s*\n", tail)
    if blank:
        tail = tail[: blank.start()]
    return tail.strip()


def detect_obligation_confirmations(assistant_text: str) -> list[dict[str, Any]]:
    """Parse assistant reply for obligation confirmations without persisting."""
    text = (assistant_text or "").strip()
    if not text:
        return []

    matches = list(_TRIGGER_RE.finditer(text))
    if not matches:
        return []

    pending: list[dict[str, Any]] = []
    seen_names: set[str] = set()

    for match in matches:
        block = _extract_block(text, match.end())
        if not block:
            continue

        name = _name_from_block(block)
        amounts = parse_obligation_amounts(block)
        if name.lower() in seen_names:
            continue
        seen_names.add(name.lower())

        monthly = amounts.get("monthly_payment")
        symbol = "€"
        if monthly is not None:
            try:
                monthly_str = f"{symbol}{float(monthly):.2f}"
            except (TypeError, ValueError):
                monthly_str = f"{symbol}?"
            description = f"Добавить в обязательства: {name} — {monthly_str}/мес"
        else:
            description = f"Добавить в обязательства: {name}"

        pending.append({
            "type": "create_obligation",
            "description": description,
            "confidence": 0.8,
            "data": {
                "name": name,
                "monthly_payment": amounts.get("monthly_payment"),
                "total_amount": amounts.get("total_amount"),
                "remaining_amount": amounts.get("remaining_amount"),
            },
        })
    return pending


def apply_pending_obligation_action(
    db: Any, action: dict[str, Any]
) -> dict[str, Any] | None:
    """Persist a pending obligation action from detect_obligation_confirmations."""
    data = action.get("data") or {}
    name = str(data.get("name") or "").strip()
    if not name:
        return None
    return persist_obligation(
        db,
        name=name,
        monthly_payment=data.get("monthly_payment"),
        total_amount=data.get("total_amount"),
        remaining_amount=data.get("remaining_amount"),
    )


def apply_obligation_confirmations(
    db: Any, assistant_text: str
) -> list[dict[str, Any]]:
    """Parse assistant reply for obligation confirmations and upsert rows."""
    pending = detect_obligation_confirmations(assistant_text)
    updates: list[dict[str, Any]] = []
    for item in pending:
        result = apply_pending_obligation_action(db, item)
        if result is not None:
            updates.append(result)
    return updates
