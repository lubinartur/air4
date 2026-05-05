from __future__ import annotations

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException

from app.database import execute, fetch_one, get_db
from app.models.profile import UserProfileOut, UserProfileUpdate

router = APIRouter()

_PROFILE_ID = 1


def _norm_str(v: object | None) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s or None


@router.get("/profile", response_model=UserProfileOut)
async def get_profile(
    db: aiosqlite.Connection = Depends(get_db),
) -> UserProfileOut:
    row = await fetch_one(
        db, "SELECT * FROM user_profile WHERE id = ?", (_PROFILE_ID,)
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    return UserProfileOut(**row)


@router.put("/profile", response_model=UserProfileOut)
async def update_profile(
    body: UserProfileUpdate,
    db: aiosqlite.Connection = Depends(get_db),
) -> UserProfileOut:
    row = await fetch_one(
        db, "SELECT * FROM user_profile WHERE id = ?", (_PROFILE_ID,)
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Profile not found")

    name = row.get("name")
    ctx = row.get("context")
    city = row.get("city")
    profession = row.get("profession")
    monthly_income = row.get("monthly_income")
    goals = row.get("goals")
    transport = row.get("transport")

    changed = body.model_fields_set
    if "name" in changed:
        name = _norm_str(body.name)
    if "context" in changed:
        ctx = _norm_str(body.context)
    if "city" in changed:
        city = _norm_str(body.city)
    if "profession" in changed:
        profession = _norm_str(body.profession)
    if "goals" in changed:
        goals = _norm_str(body.goals)
    if "transport" in changed:
        transport = _norm_str(body.transport)
    if "monthly_income" in changed:
        if body.monthly_income is None:
            monthly_income = None
        else:
            try:
                monthly_income = float(body.monthly_income)
            except (TypeError, ValueError):
                monthly_income = None

    await execute(
        db,
        """
        UPDATE user_profile
        SET name = ?,
            context = ?,
            city = ?,
            profession = ?,
            monthly_income = ?,
            goals = ?,
            transport = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (
            name,
            ctx,
            city,
            profession,
            monthly_income,
            goals,
            transport,
            _PROFILE_ID,
        ),
    )

    updated = await fetch_one(
        db, "SELECT * FROM user_profile WHERE id = ?", (_PROFILE_ID,)
    )
    if updated is None:
        raise HTTPException(status_code=500, detail="Failed to read profile")
    return UserProfileOut(**updated)
