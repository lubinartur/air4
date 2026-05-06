from __future__ import annotations

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException

from app.database import execute, fetch_all, fetch_one, get_db
from app.models.interview import InterviewAnswerIn, InterviewAnswerOut
from app.services.interviewer import Interviewer

router = APIRouter()


@router.get("/interview/answers", response_model=list[InterviewAnswerOut])
async def list_answers(
    db: aiosqlite.Connection = Depends(get_db),
) -> list[InterviewAnswerOut]:
    rows = await fetch_all(
        db,
        """
        SELECT *
        FROM interview_answers
        ORDER BY datetime(created_at) DESC, id DESC
        """,
    )
    return [InterviewAnswerOut(**r) for r in rows]


@router.post("/interview/answers", response_model=InterviewAnswerOut)
async def save_answer(
    body: InterviewAnswerIn,
    db: aiosqlite.Connection = Depends(get_db),
) -> InterviewAnswerOut:
    q = (body.question or "").strip()
    a = (body.answer or "").strip()
    if not q or not a:
        raise HTTPException(status_code=400, detail="question and answer are required")

    new_id = await execute(
        db,
        """
        INSERT INTO interview_answers (question, answer)
        VALUES (?, ?)
        """,
        (q, a),
    )
    row = await fetch_one(db, "SELECT * FROM interview_answers WHERE id = ?", (new_id,))
    if row is None:
        raise HTTPException(status_code=500, detail="Failed to save answer")
    return InterviewAnswerOut(**row)


@router.get("/interview/questions")
async def generate_questions(
    db: aiosqlite.Connection = Depends(get_db),
) -> dict[str, list[dict[str, str]]]:
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
    existing = await fetch_all(
        db,
        """
        SELECT question, answer, created_at
        FROM interview_answers
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT 50
        """,
    )

    interviewer = Interviewer()
    qs = await interviewer.generate_questions(
        profile=dict(profile) if profile else None,
        facts=facts,
        events=events,
        projects=projects,
        existing_answers=existing,
    )
    return {"questions": [{"question": q} for q in qs]}

