from __future__ import annotations

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException

from app.database import execute, fetch_all, fetch_one, get_db
from app.models.observation import ObservationGenerateOut, ObservationOut
from app.services.cross_sphere_analyzer import hours_since_iso
from app.services.observation_engine import ObservationEngine

router = APIRouter()


@router.get("/observations", response_model=list[ObservationOut])
async def list_observations(
    db: aiosqlite.Connection = Depends(get_db),
) -> list[ObservationOut]:
    rows = await fetch_all(
        db,
        """
        SELECT *
        FROM observations
        ORDER BY
          CASE WHEN COALESCE(is_read, 0) = 0 THEN 0 ELSE 1 END,
          datetime(created_at) DESC,
          id DESC
        """,
    )
    return [ObservationOut(**r) for r in rows]


@router.post("/observations/generate", response_model=ObservationGenerateOut)
async def generate_observations(
    db: aiosqlite.Connection = Depends(get_db),
) -> ObservationGenerateOut:
    recent = await fetch_all(
        db,
        """
        SELECT created_at
        FROM observations
        WHERE datetime(created_at) >= datetime('now', '-7 days')
        ORDER BY datetime(created_at) DESC
        """,
    )
    if len(recent) >= 2:
        # compute remaining days until we drop below quota
        oldest = recent[-1].get("created_at") if recent else None
        hours = hours_since_iso(str(oldest) if oldest else None)
        days_remaining = None
        if hours is not None:
            days_remaining = max(0.0, round((7 * 24 - hours) / 24.0, 2))
        return ObservationGenerateOut(created=0, cooldown_days_remaining=days_remaining)

    profile = await fetch_one(db, "SELECT * FROM user_profile WHERE id = 1")
    facts = await fetch_all(db, "SELECT key, value FROM user_facts ORDER BY key ASC")
    events = await fetch_all(
        db,
        """
        SELECT date, title, description, category, source, created_at
        FROM events
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT 50
        """,
    )
    projects = await fetch_all(
        db,
        """
        SELECT name, description, status, started_at, updated_at
        FROM projects
        WHERE status = 'active'
        ORDER BY datetime(updated_at) DESC, id DESC
        """,
    )
    confirmed_hypotheses = await fetch_all(
        db,
        """
        SELECT text, confirmed_at
        FROM hypotheses
        WHERE status = 'confirmed'
        ORDER BY datetime(confirmed_at) DESC, id DESC
        LIMIT 20
        """,
    )
    cross_sphere = await fetch_all(
        db,
        """
        SELECT sphere1, sphere2, title, description, confidence, created_at
        FROM cross_sphere_insights
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT 20
        """,
    )
    uploads = await fetch_all(
        db,
        """
        SELECT id, period_start, period_end, created_at
        FROM uploads
        ORDER BY period_end DESC, id DESC
        LIMIT 24
        """,
    )
    upload_ids = [int(u["id"]) for u in uploads]
    spending_periods: dict[str, object] = {"uploads": []}
    if upload_ids:
        totals = await fetch_all(
            db,
            f"""
            SELECT upload_id, COALESCE(SUM(amount), 0) AS total_spent
            FROM transactions
            WHERE COALESCE(is_debit, 0) = 1
              AND COALESCE(is_internal_transfer, 0) = 0
              AND upload_id IN ({",".join(["?"] * len(upload_ids))})
            GROUP BY upload_id
            """,
            upload_ids,
        )
        total_by_id = {int(r["upload_id"]): float(r["total_spent"] or 0.0) for r in totals}
        for u in uploads:
            uid = int(u["id"])
            spending_periods["uploads"].append(
                {
                    "upload_id": uid,
                    "period_start": u.get("period_start"),
                    "period_end": u.get("period_end"),
                    "total_spent": round(float(total_by_id.get(uid, 0.0)), 2),
                }
            )

    engine = ObservationEngine()
    obs = await engine.generate_observations(
        profile=dict(profile) if profile else None,
        events=events,
        facts=facts,
        projects=projects,
        confirmed_hypotheses=confirmed_hypotheses,
        cross_sphere_insights=cross_sphere,
        spending_periods=spending_periods,
    )

    created = 0
    for o in obs:
        title = str(o.get("title") or "").strip()
        body = str(o.get("body") or "").strip()
        typ = str(o.get("observation_type") or "pattern").strip()
        if not title or not body:
            continue
        await execute(
            db,
            """
            INSERT INTO observations (title, body, observation_type, is_read)
            VALUES (?, ?, ?, 0)
            """,
            (title, body, typ),
        )
        created += 1

    return ObservationGenerateOut(created=created, cooldown_days_remaining=None)


@router.put("/observations/{observation_id}/read", response_model=ObservationOut)
async def mark_read(
    observation_id: int,
    db: aiosqlite.Connection = Depends(get_db),
) -> ObservationOut:
    row = await fetch_one(db, "SELECT * FROM observations WHERE id = ?", (int(observation_id),))
    if row is None:
        raise HTTPException(status_code=404, detail="Observation not found")
    await execute(
        db,
        "UPDATE observations SET is_read = 1 WHERE id = ?",
        (int(observation_id),),
    )
    updated = await fetch_one(db, "SELECT * FROM observations WHERE id = ?", (int(observation_id),))
    if updated is None:
        raise HTTPException(status_code=500, detail="Failed to read observation")
    return ObservationOut(**updated)


@router.delete("/observations/{observation_id}")
async def delete_observation(
    observation_id: int,
    db: aiosqlite.Connection = Depends(get_db),
) -> dict[str, bool]:
    row = await fetch_one(db, "SELECT id FROM observations WHERE id = ?", (int(observation_id),))
    if row is None:
        raise HTTPException(status_code=404, detail="Observation not found")
    await execute(db, "DELETE FROM observations WHERE id = ?", (int(observation_id),))
    return {"ok": True}

