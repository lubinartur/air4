from __future__ import annotations

from fastapi import APIRouter

from database import fetch_all, fetch_one, get_db
from routers.profile import _parse_goals
from schemas import GoalItemOut, GoalsListOut

router = APIRouter()

_PROFILE_ID = 1


@router.get("/goals", response_model=GoalsListOut)
def list_goals() -> GoalsListOut:
    goals: list[GoalItemOut] = []

    with get_db() as conn:
        profile_row = fetch_one(conn, "SELECT goals FROM user_profile WHERE id = ?", (_PROFILE_ID,))
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

    for idx, title in enumerate(_parse_goals(profile_row.get("goals") if profile_row else None), start=1):
        goals.append(GoalItemOut(id=idx, title=title, source="profile"))

    for row in fact_rows:
        value = str(row.get("value") or "").strip()
        if not value:
            continue
        goals.append(
            GoalItemOut(
                id=int(row["id"]),
                title=value,
                source="facts",
                key=str(row.get("key") or ""),
            )
        )

    return GoalsListOut(goals=goals)
