from __future__ import annotations

import os

from fastapi import APIRouter

from database import fetch_one, get_db
from schemas import InterviewAnswerIn, InterviewAnswerOut, InterviewQuestionOut
from services.interviewer import (
    get_interview_question,
    get_pending_question,
    save_interview_answer,
)

router = APIRouter()


def _api_key() -> str:
    return os.getenv("ANTHROPIC_API_KEY", "") or ""


@router.get("/interview/question", response_model=InterviewQuestionOut)
async def interview_question() -> InterviewQuestionOut:
    with get_db() as conn:
        pending = get_pending_question(conn)
        if pending:
            return InterviewQuestionOut(
                has_question=True,
                question=pending["question"],
                domain=pending["domain"],
            )

        question = await get_interview_question(conn, _api_key())
        if not question:
            return InterviewQuestionOut(has_question=False)

        row = fetch_one(
            conn,
            """
            SELECT domain FROM interview_answers
            WHERE question = ?
            ORDER BY datetime(created_at) DESC, id DESC
            LIMIT 1
            """,
            (question,),
        )

    domain = str(row["domain"]) if row and row.get("domain") else None
    return InterviewQuestionOut(has_question=True, question=question, domain=domain)


@router.put("/interview/answer", response_model=InterviewAnswerOut)
def interview_answer(body: InterviewAnswerIn) -> InterviewAnswerOut:
    with get_db() as conn:
        saved = save_interview_answer(conn, body.question, body.answer)
    return InterviewAnswerOut(saved=saved)
