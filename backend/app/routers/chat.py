from __future__ import annotations

import json

import aiosqlite
from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse

from app.database import execute, fetch_all, fetch_one, get_db
from app.models.event import EventOut
from app.models.fact import UserFactOut
from app.models.transaction import ChatIn
from app.routers.summary import _latest_upload_id, get_summary
from app.services.analyzer import OllamaAnalyzer
from app.services.event_extractor import EventExtractor
from app.services.fact_extractor import FactExtractor


router = APIRouter()


@router.post("/chat")
async def chat(
    body: ChatIn,
    upload_id: int | None = Query(None),
    db: aiosqlite.Connection = Depends(get_db),
):
    event_saved: EventOut | None = None
    extractor = EventExtractor()
    extracted = await extractor.extract_event(body.message)
    if extracted:
        eid = await execute(
            db,
            """
            INSERT INTO events (date, title, description, category, source)
            VALUES (?, ?, ?, ?, 'chat')
            """,
            (
                extracted["date"],
                extracted["title"],
                extracted["description"],
                extracted["category"],
            ),
        )
        row = await fetch_one(db, "SELECT * FROM events WHERE id = ?", (eid,))
        if row is not None:
            event_saved = EventOut(**row)

    extracted_project = await extractor.extract_project(body.message)
    if extracted_project:
        pname = extracted_project.get("name", "").strip()
        if pname:
            existing = await fetch_one(
                db,
                "SELECT * FROM projects WHERE lower(name) = lower(?) LIMIT 1",
                (pname,),
            )
            if existing is None:
                await execute(
                    db,
                    """
                    INSERT INTO projects (name, description, status, started_at)
                    VALUES (?, ?, ?, ?)
                    """,
                    (
                        pname,
                        extracted_project.get("description") or None,
                        extracted_project.get("status") or "active",
                        extracted_project.get("started_at") or None,
                    ),
                )
            else:
                await execute(
                    db,
                    """
                    UPDATE projects
                    SET description = COALESCE(?, description),
                        status = ?,
                        started_at = COALESCE(?, started_at),
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                    """,
                    (
                        extracted_project.get("description") or None,
                        extracted_project.get("status") or existing.get("status") or "active",
                        extracted_project.get("started_at") or None,
                        int(existing["id"]),
                    ),
                )

    fact_extractor = FactExtractor()
    facts_saved_rows = await fact_extractor.extract_and_save(db, body.message)
    facts_saved = [UserFactOut(**r) for r in facts_saved_rows]

    if upload_id is None:
        upload_id = await _latest_upload_id(db)

    if upload_id is None:
        summary = {"upload_id": None, "total_spent": 0.0, "by_category": []}
        tx_rows: list[dict] = []
    else:
        summary = (await get_summary(upload_id=upload_id, db=db)).model_dump()
        tx_rows = await fetch_all(
            db,
            """
            SELECT date, description, amount, category
            FROM transactions
            WHERE upload_id = ?
              AND COALESCE(is_debit, 0) = 1
              AND COALESCE(is_internal_transfer, 0) = 0
              AND description NOT LIKE 'lõppsaldo%'
              AND description NOT LIKE 'Käive%'
            ORDER BY amount DESC
            LIMIT 100
            """,
            (int(upload_id),),
        )

    events_rows = await fetch_all(
        db,
        """
        SELECT date, title, description, category, source, created_at
        FROM events
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT 20
        """,
    )

    profile_row = await fetch_one(db, "SELECT * FROM user_profile WHERE id = 1")
    profile_dict: dict | None = (
        dict(profile_row) if profile_row is not None else None
    )

    user_facts_rows = await fetch_all(
        db,
        """
        SELECT key, value
        FROM user_facts
        ORDER BY key ASC
        """,
    )

    active_projects_rows = await fetch_all(
        db,
        """
        SELECT name, description, status, started_at
        FROM projects
        WHERE status = 'active'
        ORDER BY datetime(updated_at) DESC, id DESC
        """,
    )

    confirmed_hypotheses_rows = await fetch_all(
        db,
        """
        SELECT text
        FROM hypotheses
        WHERE status = 'confirmed'
        ORDER BY datetime(confirmed_at) DESC, id DESC
        LIMIT 20
        """,
    )

    cross_sphere_rows = await fetch_all(
        db,
        """
        SELECT sphere1, sphere2, title, description, confidence, created_at
        FROM cross_sphere_insights
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT 10
        """,
    )

    interview_answers_rows = await fetch_all(
        db,
        """
        SELECT question, answer, created_at
        FROM interview_answers
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT 50
        """,
    )

    solved_dilemmas_rows = await fetch_all(
        db,
        """
        SELECT title, followup_answer, created_at
        FROM dilemmas
        WHERE status = 'closed'
          AND followup_answer IS NOT NULL
          AND TRIM(followup_answer) != ''
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT 30
        """,
    )

    analyzer = OllamaAnalyzer()

    async def generate():
        meta = {
            "type": "meta",
            "event_saved": event_saved.model_dump() if event_saved else None,
            "facts_saved": [f.model_dump() for f in facts_saved],
        }
        yield f"data: {json.dumps(meta, ensure_ascii=False)}\n\n"
        async for delta in analyzer.chat_stream(
            body.message,
            body.history or [],
            summary,
            events=events_rows,
            profile=profile_dict,
            transactions=tx_rows,
            user_facts=user_facts_rows,
            projects=active_projects_rows,
            confirmed_hypotheses=confirmed_hypotheses_rows,
            cross_sphere_insights=cross_sphere_rows,
            solved_dilemmas=solved_dilemmas_rows,
            interview_answers=interview_answers_rows,
            current_page=body.current_page,
        ):
            yield f"data: {json.dumps({'type': 'delta', 'text': delta}, ensure_ascii=False)}\n\n"
        yield f"data: {json.dumps({'type': 'done'}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )

