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
from datetime import date, datetime, timedelta
from difflib import SequenceMatcher

from database import fetch_all
from services.llm_client import parse_json_object
from services.llm_client_shared import call_claude

logger = logging.getLogger(__name__)

# Deduplication: scan dilemmas created in this window and merge new
# extractions into a matching one instead of inserting a duplicate.
# 24h is wide enough to cover multi-session deliberations (user mulls a
# purchase across an evening + next morning) without merging unrelated
# decisions that happen to share a tag weeks apart.
_DEDUP_WINDOW_HOURS = 24

# Threshold for SequenceMatcher.ratio() on (lowercased) titles. 0.6 is
# permissive enough to merge "Покупка ноутбука" with "Отказ от покупки
# ноутбука" (~0.74) and "Купить ноутбук" (~0.7), while still leaving
# unrelated decisions like "Сменить работу" as their own rows.
_TITLE_SIMILARITY_THRESHOLD = 0.6

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


def _parse_tags_field(raw: object | None) -> list[str]:
    """`tags` is JSON in SQLite — tolerate empty / malformed payloads
    so a single corrupt row never blocks deduplication for the rest."""
    if not raw:
        return []
    if isinstance(raw, list):
        return [str(x).strip().lower() for x in raw if str(x).strip()]
    try:
        parsed = json.loads(str(raw))
    except (TypeError, json.JSONDecodeError):
        return []
    if not isinstance(parsed, list):
        return []
    return [str(x).strip().lower() for x in parsed if str(x).strip()]


def _find_duplicate(
    conn: sqlite3.Connection,
    *,
    title: str,
    tags: list[str],
) -> dict | None:
    """Return the best existing dilemma to merge into, or None.

    A row in the last ``_DEDUP_WINDOW_HOURS`` qualifies when EITHER:
      • its title is ≥``_TITLE_SIMILARITY_THRESHOLD`` similar to the
        new title (SequenceMatcher on lowercased strings), OR
      • it shares at least one tag with the new extraction.

    When multiple rows qualify we keep the one with the highest title
    similarity (ties broken by recency, since we pre-sort DESC). The
    30-minute "same session" rule from the spec is naturally covered:
    rows that recent will always be inside the 24h window and almost
    always share a tag with the new extraction.
    """
    cutoff = (
        datetime.now() - timedelta(hours=_DEDUP_WINDOW_HOURS)
    ).strftime("%Y-%m-%d %H:%M:%S")
    rows = fetch_all(
        conn,
        """
        SELECT id, title, description, status, decision_made, tags,
               followup_due, created_at
          FROM dilemmas
         WHERE datetime(created_at) >= datetime(?)
         ORDER BY datetime(created_at) DESC, id DESC
        """,
        (cutoff,),
    )
    if not rows:
        return None

    new_title_lower = title.lower()
    new_tags_set = {t.lower() for t in tags}

    best: tuple[float, dict] | None = None
    for row in rows:
        existing_title = str(row.get("title") or "")
        ratio = SequenceMatcher(
            None, new_title_lower, existing_title.lower()
        ).ratio()
        existing_tags = set(_parse_tags_field(row.get("tags")))
        tag_overlap = bool(new_tags_set & existing_tags) if new_tags_set else False
        if ratio >= _TITLE_SIMILARITY_THRESHOLD or tag_overlap:
            if best is None or ratio > best[0]:
                best = (ratio, row)
    return best[1] if best else None


def _merge_into_existing(
    conn: sqlite3.Connection,
    existing: dict,
    *,
    new_description: str | None,
    new_decision_made: str | None,
    new_status: str,
    new_tags: list[str],
) -> dict:
    """Apply a non-destructive update to an existing dilemma row.

    Merge rules (all designed to preserve user-visible context):
      • **status** — only promote ``open → decided``; never demote.
      • **decision_made** — adopt the new value only when it's strictly
        more informative than what's stored (existing is empty, or new
        is meaningfully longer). Stops a terse re-statement of the
        same choice from clobbering a richer earlier phrasing.
      • **description** — fill if missing; otherwise keep the original.
      • **tags** — union, preserving the existing tag order so anything
        a future UI surfaces stays stable across merges.
      • **followup_due** — left untouched so the 14-day clock keeps
        ticking from the original decision moment.
      • **title** — left untouched (the canonical thread name).
    """
    existing_decision = (existing.get("decision_made") or "").strip() or None
    if new_decision_made:
        # "More specific" = clearly longer than what's stored. Equal /
        # shorter restatements are ignored so we don't overwrite e.g.
        # "Купить MacBook Pro 14 36GB" with a later "Купить MacBook".
        if not existing_decision or len(new_decision_made) > len(existing_decision) + 4:
            next_decision = new_decision_made
        else:
            next_decision = existing_decision
    else:
        next_decision = existing_decision

    existing_status = str(existing.get("status") or "open").strip().lower()
    next_status = (
        "decided"
        if (existing_status == "open" and new_status == "decided")
        else existing_status
    )

    existing_description = (existing.get("description") or "").strip() or None
    next_description = existing_description or new_description

    existing_tags = _parse_tags_field(existing.get("tags"))
    seen = set(existing_tags)
    merged_tags = list(existing_tags)
    for tag in new_tags:
        if tag not in seen:
            merged_tags.append(tag)
            seen.add(tag)
    tags_json = json.dumps(merged_tags, ensure_ascii=False)

    conn.execute(
        """
        UPDATE dilemmas
           SET description   = ?,
               decision_made = ?,
               status        = ?,
               tags          = ?
         WHERE id = ?
        """,
        (
            next_description,
            next_decision,
            next_status,
            tags_json,
            int(existing["id"]),
        ),
    )
    conn.commit()

    return {
        "id": int(existing["id"]),
        "title": str(existing.get("title") or ""),
        "status": next_status,
        "decision_made": next_decision,
        "followup_due": existing.get("followup_due"),
        "merged": True,
    }


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

    # Dedup: if a related dilemma was created in the last 24h, merge
    # the new extraction into it instead of spawning a duplicate row.
    # Prevents the failure mode where every chat turn in the same
    # purchase-decision conversation produces a fresh dilemma.
    existing = _find_duplicate(conn, title=title, tags=tags_clean)
    if existing is not None:
        merged = _merge_into_existing(
            conn,
            existing,
            new_description=description,
            new_decision_made=decision_made,
            new_status=status,
            new_tags=tags_clean,
        )
        logger.info(
            "decision_extractor: merged into existing dilemma id=%s (new title=%r)",
            merged["id"],
            title,
        )
        return merged

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
