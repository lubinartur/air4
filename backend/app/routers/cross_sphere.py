from __future__ import annotations

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException

from app.database import execute, fetch_all, fetch_one, get_db
from app.models.cross_sphere import CrossSphereAnalyzeOut, CrossSphereInsightOut
from app.services.cross_sphere_analyzer import CrossSphereAnalyzer, hours_since_iso

router = APIRouter()


@router.get("/cross-sphere", response_model=list[CrossSphereInsightOut])
async def list_cross_sphere(
    db: aiosqlite.Connection = Depends(get_db),
) -> list[CrossSphereInsightOut]:
    rows = await fetch_all(
        db,
        """
        SELECT id, sphere1, sphere2, title, description, confidence, created_at
        FROM cross_sphere_insights
        ORDER BY datetime(created_at) DESC, id DESC
        """,
    )
    return [CrossSphereInsightOut(**r) for r in rows]


@router.post("/cross-sphere/analyze", response_model=CrossSphereAnalyzeOut)
async def analyze_cross_sphere(
    db: aiosqlite.Connection = Depends(get_db),
) -> CrossSphereAnalyzeOut:
    last = await fetch_one(
        db,
        "SELECT created_at FROM cross_sphere_insights ORDER BY datetime(created_at) DESC, id DESC LIMIT 1",
    )
    hours = hours_since_iso((last or {}).get("created_at") if last else None)
    if hours is not None and hours < 24:
        return CrossSphereAnalyzeOut(
            created=0, cooldown_hours_remaining=round(24 - hours, 2)
        )

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
        cats = await fetch_all(
            db,
            f"""
            SELECT upload_id, category, COALESCE(SUM(amount), 0) AS amount
            FROM transactions
            WHERE COALESCE(is_debit, 0) = 1
              AND COALESCE(is_internal_transfer, 0) = 0
              AND upload_id IN ({",".join(["?"] * len(upload_ids))})
            GROUP BY upload_id, category
            ORDER BY upload_id ASC, amount DESC
            """,
            upload_ids,
        )
        cats_by_upload: dict[int, list[dict[str, object]]] = {}
        for r in cats:
            uid = int(r["upload_id"])
            cats_by_upload.setdefault(uid, []).append(
                {"category": r["category"], "amount": float(r["amount"] or 0.0)}
            )
        for u in uploads:
            uid = int(u["id"])
            spending_periods["uploads"].append(
                {
                    "upload_id": uid,
                    "period_start": u.get("period_start"),
                    "period_end": u.get("period_end"),
                    "total_spent": round(float(total_by_id.get(uid, 0.0)), 2),
                    "by_category": (cats_by_upload.get(uid) or [])[:8],
                }
            )

    analyzer = CrossSphereAnalyzer()
    insights = await analyzer.analyze_connections(
        profile=dict(profile) if profile else None,
        events=events,
        facts=facts,
        projects=projects,
        confirmed_hypotheses=confirmed_hypotheses,
        spending_periods=spending_periods,
    )

    created = 0
    for ins in insights:
        title = str(ins.get("title") or "").strip()
        desc = str(ins.get("description") or "").strip()
        if not title or not desc:
            continue
        await execute(
            db,
            """
            INSERT INTO cross_sphere_insights (sphere1, sphere2, title, description, confidence)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                ins.get("sphere1"),
                ins.get("sphere2"),
                title,
                desc,
                ins.get("confidence"),
            ),
        )
        created += 1

    return CrossSphereAnalyzeOut(created=created, cooldown_hours_remaining=None)


@router.delete("/cross-sphere/{insight_id}")
async def delete_cross_sphere(
    insight_id: int,
    db: aiosqlite.Connection = Depends(get_db),
) -> dict[str, bool]:
    cur = await db.execute(
        "DELETE FROM cross_sphere_insights WHERE id = ? RETURNING id",
        (int(insight_id),),
    )
    deleted = await cur.fetchone()
    await db.commit()
    if deleted is None:
        raise HTTPException(
            status_code=404,
            detail="Cross-sphere insight not found",
        )
    return {"ok": True}

