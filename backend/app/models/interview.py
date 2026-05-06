from __future__ import annotations

from pydantic import BaseModel, Field


class InterviewAnswerIn(BaseModel):
    question: str = Field(..., min_length=1)
    answer: str = Field(..., min_length=1)


class InterviewAnswerOut(BaseModel):
    id: int
    question: str
    answer: str
    created_at: str | None = None

