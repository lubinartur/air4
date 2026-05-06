from __future__ import annotations

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException

from app.database import execute, fetch_all, fetch_one, get_db
from app.models.hypothesis import HypothesisGenerateOut, HypothesisOut, HypothesisUpdateIn
from app.services.hypothesis_generator import HypothesisGenerator, hours_since_iso

router = APIRouter()


@router.get("/hypotheses", response_model=list[HypothesisOut])
async def list_hypotheses(
    db: aiosqlite.Connection = Depends(get_db),
) -> list[HypothesisOut]:
    rows = await fetch_all(
        db,
        """
        SELECT *
        FROM hypotheses
        ORDER BY datetime(created_at) DESC, id DESC
        """,
    )
    return [HypothesisOut(**r) for r in rows]


@router.post("/hypotheses/generate", response_model=HypothesisGenerateOut)
async def generate_hypotheses(
    db: aiosqlite.Connection = Depends(get_db),
) -> HypothesisGenerateOut:
    last = await fetch_one(
        db,
        "SELECT created_at FROM hypotheses ORDER BY datetime(created_at) DESC, id DESC LIMIT 1",
    )
    hours = hours_since_iso((last or {}).get("created_at") if last else None)
    if hours is not None and hours < 24:
        return HypothesisGenerateOut(
            created=0, cooldown_hours_remaining=round(24 - hours, 2)
        )

    profile = await fetch_one(db, "SELECT * FROM user_profile WHERE id = 1")
    facts = await fetch_all(
        db,
        "SELECT key, value FROM user_facts ORDER BY key ASC",
    )
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

    # Spending patterns across periods: use uploads table + aggregated transaction sums per upload.
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
    spending: dict[str, object] = {"uploads": []}
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
            spending["uploads"].append(
                {
                    "upload_id": uid,
                    "period_start": u.get("period_start"),
                    "period_end": u.get("period_end"),
                    "total_spent": round(float(total_by_id.get(uid, 0.0)), 2),
                    "by_category": (cats_by_upload.get(uid) or [])[:6],
                }
            )

    gen = HypothesisGenerator()
    texts = await gen.generate(
        profile=dict(profile) if profile else None,
        spending_summary=spending,
        events=events,
        facts=facts,
        projects=projects,
    )

    created = 0
    for t in texts:
        if not t.strip():
            continue
        await execute(
            db,
            "INSERT INTO hypotheses (text, status) VALUES (?, 'pending')",
            (t.strip(),),
        )
        created += 1

    return HypothesisGenerateOut(created=created, cooldown_hours_remaining=None)


@router.put("/hypotheses/{hypothesis_id}", response_model=HypothesisOut)
async def update_hypothesis(
    hypothesis_id: int,
    body: HypothesisUpdateIn,
    db: aiosqlite.Connection = Depends(get_db),
) -> HypothesisOut:
    row = await fetch_one(db, "SELECT * FROM hypotheses WHERE id = ?", (int(hypothesis_id),))
    if row is None:
        raise HTTPException(status_code=404, detail="Hypothesis not found")

    if body.status == "confirmed":
        await execute(
            db,
            """
            UPDATE hypotheses
            SET status = 'confirmed',
                confirmed_at = CURRENT_TIMESTAMP,
                rejected_at = NULL
            WHERE id = ?
            """,
            (int(hypothesis_id),),
        )
    else:
        await execute(
            db,
            """
            UPDATE hypotheses
            SET status = 'rejected',
                rejected_at = CURRENT_TIMESTAMP,
                confirmed_at = NULL
            WHERE id = ?
            """,
            (int(hypothesis_id),),
        )

    updated = await fetch_one(db, "SELECT * FROM hypotheses WHERE id = ?", (int(hypothesis_id),))
    if updated is None:
        raise HTTPException(status_code=500, detail="Failed to read hypothesis")
    return HypothesisOut(**updated)


@router.delete("/hypotheses/{hypothesis_id}")
async def delete_hypothesis(
    hypothesis_id: int,
    db: aiosqlite.Connection = Depends(get_db),
) -> dict[str, bool]:
    row = await fetch_one(db, "SELECT id FROM hypotheses WHERE id = ?", (int(hypothesis_id),))
    if row is None:
        raise HTTPException(status_code=404, detail="Hypothesis not found")
    await execute(db, "DELETE FROM hypotheses WHERE id = ?", (int(hypothesis_id),))
    return {"ok": True}

