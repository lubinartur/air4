from __future__ import annotations

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException

from app.database import execute, fetch_all, fetch_one, get_db
from app.models.fact import UserFactOut

router = APIRouter()


@router.get("/facts", response_model=list[UserFactOut])
async def list_facts(
    db: aiosqlite.Connection = Depends(get_db),
) -> list[UserFactOut]:
    rows = await fetch_all(
        db,
        """
        SELECT id, key, value, source, created_at, updated_at
        FROM user_facts
        ORDER BY key ASC
        """,
    )
    return [UserFactOut(**r) for r in rows]


@router.delete("/facts/{fact_id}")
async def delete_fact(
    fact_id: int,
    db: aiosqlite.Connection = Depends(get_db),
) -> dict[str, bool]:
    row = await fetch_one(db, "SELECT id FROM user_facts WHERE id = ?", (fact_id,))
    if row is None:
        raise HTTPException(status_code=404, detail="Fact not found")
    await execute(db, "DELETE FROM user_facts WHERE id = ?", (fact_id,))
    return {"ok": True}
