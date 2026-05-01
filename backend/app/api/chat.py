"""Chat API (memory-backed; simulated replies until LLM integration)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.services import chat_service

router = APIRouter()


class ChatRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    message: str = Field(..., min_length=1)


@router.post("/chat")
def post_chat(body: ChatRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    return chat_service.chat(db, body.message)
