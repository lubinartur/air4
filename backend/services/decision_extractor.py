"""Decision detection from chat messages → `dilemmas` table.

The chat handler schedules `extract_decisions` as a background task
after every user turn (alongside body/event/fact extractors). The flow:

1. **Cheap keyword pre-filter** — Russian decision-marker stems like
   "реши", "выбра", "буду делать". Skips the LLM entirely for chats
   that obviously aren't about a decision, so the feature has near-zero
   latency/cost overhead on typical conversation.

2. **LLM extraction** — when a keyword fires, call Claude with a
   structured prompt that returns a JSON object describing the
   decision (or `{"is_decision": false}` when the heuristic was wrong).

3. **Insert into `dilemmas`** — title, description, decision_made,
   status, tags. `followup_due` is always set to `today + 14 days`
   so the Overview AIR4 advisor can surface a follow-up question
   ("какой исход?") on or after that date.

Failures (LLM down, malformed JSON, missing title) are logged and
swallowed — the chat reply always lands; the worst case is silently
missing a dilemma row, which the user can recreate manually later.
"""

from __future__ import annotations

import json
import logging
import sqlite3
from datetime import date, timedelta

from services.llm_client import parse_json_object
from services.llm_client_shared import call_claude

logger = logging.getLogger(__name__)

# Lowercase Russian stems that indicate a decision is on the table.
# Substring match (not word-boundary) intentionally covers every
# inflection of the verb — "решил/решила/решили/решение/решено" all
# share "реши". False positives are fine because the LLM is the
# authoritative filter; the pre-filter only exists to avoid burning
# tokens on the >95% of chat turns that aren't about decisions.
_DECISION_STEMS: tuple[str, ...] = (
    "реши",          # решил, решила, решили, решение, решено
    "решен",         # решено
    "решаю",         # present-tense "I am deciding"
    "выбра",         # выбрал, выбрала, выбрали
    "выбира",        # выбираю, выбираем
    "определилс",    # определился, определилась
    "остановилс",    # остановился, остановилась (на варианте X)
    "думаю сдела",
    "думаю купи",
    "думаю взя",
    "думаю пойти",
    "думаю перейти",
    "буду дела",
    "буду пробова",
    "буду меня",
    "буду покупа",
)


def _has_decision_keyword(text: str) -> bool:
    lowered = (text or "").lower()
    return any(stem in lowered for stem in _DECISION_STEMS)


_PROMPT = """You analyze user chat messages (Russian) to detect when the user is making or actively considering a meaningful life/work decision.

Track only consequential decisions: career, finance, health, major purchases, relationships, projects, lifestyle changes. Do NOT track trivial daily choices ("what to eat for lunch").

Read the user messages below and respond with ONE JSON object.

When a meaningful decision IS present, return:
{
  "is_decision": true,
  "title": "Short Russian title, max 80 chars",
  "description": "1–2 sentence Russian summary of the situation",
  "decision_made": "What was actually chosen (Russian) — null if still deliberating",
  "status": "decided" | "open",
  "tags": ["finance", "health", "career", "projects", "relationships", "lifestyle"]
}

`status="open"` when the user is still weighing options (future tense, "думаю", "буду"). `status="decided"` when they've committed (past tense, "решил", "выбрал").

Pick 1–3 tags from the list above; lowercase English only.

When NO meaningful decision is being discussed, return: {"is_decision": false}

Output ONLY the JSON object — no markdown, no commentary.

User messages:
"""


async def extract_decisions(
    user_messages: list[str],
    conn: sqlite3.Connection,
    api_key: str,
) -> dict | None:
    """Detect a decision in the recent chat turn and persist a dilemma.

    Returns the inserted row's identifying fields on success, or
    ``None`` when nothing was extracted (no keyword match, LLM error,
    or LLM said is_decision=false / missing title).
    """
    if not user_messages or not api_key.strip():
        return None

    combined = "\n".join(user_messages)
    if not _has_decision_keyword(combined):
        return None

    # Last 5 messages keeps the prompt cheap while preserving recent
    # context — long histories rarely add signal for decision detection.
    prompt = _PROMPT + "\n".join(
        f"- {m}" for m in user_messages[-5:] if m and m.strip()
    )

    try:
        response = await call_claude(
            prompt=prompt,
            api_key=api_key,
            max_tokens=512,
            temperature=0,
        )
    except Exception:
        logger.exception("decision_extractor: LLM call failed")
        return None

    data = parse_json_object(response)
    if not data.get("is_decision"):
        return None

    title = str(data.get("title") or "").strip()
    if not title:
        logger.info(
            "decision_extractor: LLM returned is_decision=true but no title; skipping"
        )
        return None
    # Cap title length defensively in case the LLM ignored the 80-char limit.
    title = title[:300]

    description = (str(data.get("description") or "").strip() or None)
    decision_made = (str(data.get("decision_made") or "").strip() or None)

    status = str(data.get("status") or "decided").strip().lower()
    if status not in {"open", "decided"}:
        status = "decided"

    raw_tags = data.get("tags")
    if isinstance(raw_tags, list):
        tags_clean = [
            str(t).strip().lower() for t in raw_tags if str(t).strip()
        ][:5]
    else:
        tags_clean = []
    tags_json = json.dumps(tags_clean, ensure_ascii=False)

    followup_due = (date.today() + timedelta(days=14)).isoformat()

    cur = conn.execute(
        """
        INSERT INTO dilemmas
            (title, description, status, decision_made, tags, followup_due)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (title, description, status, decision_made, tags_json, followup_due),
    )
    conn.commit()
    new_id = int(cur.lastrowid)
    logger.info(
        "decision_extractor: inserted dilemma id=%s title=%r status=%r followup_due=%s",
        new_id,
        title,
        status,
        followup_due,
    )
    return {
        "id": new_id,
        "title": title,
        "status": status,
        "decision_made": decision_made,
        "followup_due": followup_due,
    }
