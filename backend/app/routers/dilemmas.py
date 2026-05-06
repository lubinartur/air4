from __future__ import annotations

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException

from app.database import execute, fetch_all, fetch_one, get_db
from app.models.dilemma import DilemmaCreateIn, DilemmaFollowupIn, DilemmaOut
from app.services.dilemma_analyzer import DilemmaAnalyzer

router = APIRouter()


@router.get("/dilemmas", response_model=list[DilemmaOut])
async def list_dilemmas(db: aiosqlite.Connection = Depends(get_db)) -> list[DilemmaOut]:
    rows = await fetch_all(
        db,
        """
        SELECT *
        FROM dilemmas
        ORDER BY datetime(created_at) DESC, id DESC
        """,
    )
    return [DilemmaOut(**r) for r in rows]


@router.post("/dilemmas", response_model=DilemmaOut)
async def create_dilemma(
    body: DilemmaCreateIn,
    db: aiosqlite.Connection = Depends(get_db),
) -> DilemmaOut:
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    # Gather context
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
        ORDER BY
          CASE WHEN status = 'active' THEN 0 ELSE 1 END,
          datetime(updated_at) DESC,
          id DESC
        LIMIT 30
        """,
    )

    summary_row = await fetch_one(
        db,
        """
        SELECT
          u.id AS upload_id,
          u.period_start,
          u.period_end,
          u.created_at
        FROM uploads u
        ORDER BY datetime(u.created_at) DESC, u.id DESC
        LIMIT 1
        """,
    )
    summary: dict[str, object] = {}
    if summary_row:
        upload_id = int(summary_row["upload_id"])
        total_row = await fetch_one(
            db,
            """
            SELECT COALESCE(SUM(amount), 0) AS total_spent
            FROM transactions
            WHERE upload_id = ?
              AND COALESCE(is_debit, 0) = 1
              AND COALESCE(is_internal_transfer, 0) = 0
            """,
            (upload_id,),
        )
        by_cat = await fetch_all(
            db,
            """
            SELECT category, COALESCE(SUM(amount), 0) AS amount
            FROM transactions
            WHERE upload_id = ?
              AND COALESCE(is_debit, 0) = 1
              AND COALESCE(is_internal_transfer, 0) = 0
            GROUP BY category
            ORDER BY amount DESC
            """,
            (upload_id,),
        )
        summary = {
            "upload_id": upload_id,
            "period_start": summary_row.get("period_start"),
            "period_end": summary_row.get("period_end"),
            "created_at": summary_row.get("created_at"),
            "total_spent": float((total_row or {}).get("total_spent") or 0.0),
            "by_category": by_cat,
        }

    tx = await fetch_all(
        db,
        """
        SELECT date, description, amount, category, is_debit, is_internal_transfer
        FROM transactions
        WHERE COALESCE(is_internal_transfer, 0) = 0
        ORDER BY date DESC, id DESC
        LIMIT 100
        """,
    )

    analyzer = DilemmaAnalyzer()
    res = await analyzer.analyze_dilemma(
        dilemma_text=text,
        profile=dict(profile) if profile else None,
        facts=facts,
        events=events,
        projects=projects,
        spending_summary=summary,
        transactions=tx,
    )

    title = (res.get("title") or "").strip() or "Дилемма"
    analysis = (res.get("analysis") or "").strip() or None
    recommendation = (res.get("recommendation") or "").strip() or None

    new_id = await execute(
        db,
        """
        INSERT INTO dilemmas (title, description, options, analysis, recommendation, status, followup_due, followup_done)
        VALUES (?, ?, NULL, ?, ?, 'open', datetime('now', '+14 days'), 0)
        """,
        (title, text, analysis, recommendation),
    )
    row = await fetch_one(db, "SELECT * FROM dilemmas WHERE id = ?", (new_id,))
    if row is None:
        raise HTTPException(status_code=500, detail="Failed to create dilemma")
    return DilemmaOut(**row)


@router.get("/dilemmas/pending-followups", response_model=list[DilemmaOut])
async def pending_followups(
    db: aiosqlite.Connection = Depends(get_db),
) -> list[DilemmaOut]:
    rows = await fetch_all(
        db,
        """
        SELECT *
        FROM dilemmas
        WHERE status = 'open'
          AND COALESCE(followup_done, 0) = 0
          AND followup_due IS NOT NULL
          AND datetime(followup_due) <= datetime('now')
        ORDER BY datetime(followup_due) ASC, id ASC
        """,
    )
    return [DilemmaOut(**r) for r in rows]


@router.post("/dilemmas/{dilemma_id}/followup", response_model=DilemmaOut)
async def submit_followup(
    dilemma_id: int,
    body: DilemmaFollowupIn,
    db: aiosqlite.Connection = Depends(get_db),
) -> DilemmaOut:
    row = await fetch_one(db, "SELECT * FROM dilemmas WHERE id = ?", (int(dilemma_id),))
    if row is None:
        raise HTTPException(status_code=404, detail="Dilemma not found")
    answer = (body.answer or "").strip()
    if not answer:
        raise HTTPException(status_code=400, detail="answer is required")
    await execute(
        db,
        """
        UPDATE dilemmas
        SET followup_answer = ?,
            followup_done = 1,
            status = 'closed'
        WHERE id = ?
        """,
        (answer, int(dilemma_id)),
    )
    updated = await fetch_one(db, "SELECT * FROM dilemmas WHERE id = ?", (int(dilemma_id),))
    if updated is None:
        raise HTTPException(status_code=500, detail="Failed to save followup")
    return DilemmaOut(**updated)


@router.get("/dilemmas/{dilemma_id}", response_model=DilemmaOut)
async def get_dilemma(
    dilemma_id: int,
    db: aiosqlite.Connection = Depends(get_db),
) -> DilemmaOut:
    row = await fetch_one(db, "SELECT * FROM dilemmas WHERE id = ?", (int(dilemma_id),))
    if row is None:
        raise HTTPException(status_code=404, detail="Dilemma not found")
    return DilemmaOut(**row)


@router.delete("/dilemmas/{dilemma_id}")
async def delete_dilemma(
    dilemma_id: int,
    db: aiosqlite.Connection = Depends(get_db),
) -> dict[str, bool]:
    row = await fetch_one(db, "SELECT id FROM dilemmas WHERE id = ?", (int(dilemma_id),))
    if row is None:
        raise HTTPException(status_code=404, detail="Dilemma not found")
    await execute(db, "DELETE FROM dilemmas WHERE id = ?", (int(dilemma_id),))
    return {"ok": True}

