from __future__ import annotations

import re
from difflib import SequenceMatcher

from fastapi import APIRouter

from database import fetch_all, fetch_one, get_db
from routers.profile import _parse_goals
from schemas import GoalItemOut, GoalsListOut

router = APIRouter()

_PROFILE_ID = 1

# Goal titles are compared after normalisation: lowercased, dashes
# unified, punctuation stripped, whitespace collapsed. Two titles are
# considered the same goal when their normalised ratio crosses this
# threshold. 0.85 covers both true duplicates (identical strings) and
# the common "em-dash vs hyphen" / trailing-period variants the chat
# fact extractor likes to produce.
_SIMILARITY_THRESHOLD = 0.85


def _normalise_title(text: str) -> str:
    """Canonical form for cross-row goal comparison.

    Unifies the various dash glyphs Claude tends to mix (-, –, —),
    strips punctuation, lowercases, and collapses whitespace so e.g.
    "Цель на этот год - выйти в плюс" and
    "Цель на этот год — выйти в плюс." compare as the same goal.
    """
    s = (text or "").strip().lower()
    s = re.sub(r"[\u2010-\u2015\-]", " ", s)
    s = re.sub(r"[^\w\s]", " ", s, flags=re.UNICODE)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _is_duplicate(candidate_norm: str, kept_norms: list[str]) -> bool:
    if not candidate_norm:
        return True
    for existing in kept_norms:
        if not existing:
            continue
        ratio = SequenceMatcher(None, candidate_norm, existing).ratio()
        if ratio >= _SIMILARITY_THRESHOLD:
            return True
    return False


@router.get("/goals", response_model=GoalsListOut)
def list_goals() -> GoalsListOut:
    """Return the user's goals from two sources, deduplicated by title.

    Sources:
      * `user_profile.goals` — explicit, user-curated list. Authoritative;
        always emitted first so chat-derived facts can't shadow it.
      * `user_facts` rows whose key references goal/target/wish — goals
        the chat fact extractor discovered from conversation.

    The fact extractor creates rows under loosely-related keys
    (`financial_goal_2024`, `has_financial_goal`, `goal_financial`, …),
    so we normalise titles and drop any row whose text is >=85% similar
    to a goal we've already emitted. Profile goals win; among facts,
    higher confidence + more recent updates win (already the SQL order).
    """
    goals: list[GoalItemOut] = []
    kept_norms: list[str] = []

    with get_db() as conn:
        profile_row = fetch_one(
            conn,
            "SELECT goals FROM user_profile WHERE id = ?",
            (_PROFILE_ID,),
        )
        fact_rows = fetch_all(
            conn,
            """
            SELECT id, key, value
            FROM user_facts
            WHERE LOWER(key) LIKE '%goal%'
               OR LOWER(key) LIKE '%target%'
               OR LOWER(key) LIKE '%wish%'
            ORDER BY confidence DESC, datetime(updated_at) DESC, id DESC
            """,
        )

    for idx, title in enumerate(
        _parse_goals(profile_row.get("goals") if profile_row else None),
        start=1,
    ):
        norm = _normalise_title(title)
        if _is_duplicate(norm, kept_norms):
            continue
        # `profile:<idx>` is a stable, opaque key the projects
        # endpoint can persist in `goal_keys` and round-trip back
        # through `/api/goals`. Without it, only fact-derived goals
        # could be linked to projects (they already carry a real
        # `user_facts.key`).
        goals.append(
            GoalItemOut(
                id=idx,
                title=title,
                source="profile",
                key=f"profile:{idx}",
            )
        )
        kept_norms.append(norm)

    for row in fact_rows:
        value = str(row.get("value") or "").strip()
        if not value:
            continue
        norm = _normalise_title(value)
        if _is_duplicate(norm, kept_norms):
            continue
        goals.append(
            GoalItemOut(
                id=int(row["id"]),
                title=value,
                source="facts",
                key=str(row.get("key") or ""),
            )
        )
        kept_norms.append(norm)

    return GoalsListOut(goals=goals)
