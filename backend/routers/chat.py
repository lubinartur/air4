from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import StreamingResponse

from database import fetch_all, fetch_one, get_db
from schemas import ChatIn, ChatOut
from services.body_extractor import extract_body_data
from services.event_extractor import extract_events
from services.fact_extractor import extract_facts
from services.llm_client import chat, chat_stream
from services.prompts import (
    build_system_context,
    get_health_checkups_context,
    get_workouts_context,
    history_to_messages,
    strip_internal_xml_tags,
)
from services.summary_loader import load_summary

router = APIRouter()
logger = logging.getLogger("chat")


def _load_context(
    conn,
) -> tuple[
    Any,
    dict[str, Any] | None,
    list[dict[str, Any]],
    list[dict[str, Any]],
    str,
    str,
]:
    summary = load_summary(conn)
    profile = fetch_one(conn, "SELECT * FROM user_profile WHERE id = 1")
    facts = fetch_all(
        conn,
        """
        SELECT key, value, confidence, source
        FROM user_facts
        ORDER BY datetime(updated_at) DESC, id DESC
        LIMIT 10
        """,
    )
    events = fetch_all(
        conn,
        """
        SELECT date, title, description, domain, category, importance
        FROM events
        WHERE COALESCE(archived, 0) = 0
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT 5
        """,
    )
    workouts_context = get_workouts_context(conn)
    health_checkups_context = get_health_checkups_context(conn)
    return summary, profile, facts, events, workouts_context, health_checkups_context


def _collect_user_messages(body: ChatIn) -> list[str]:
    messages: list[str] = []
    for item in body.history or []:
        if str(item.get("role", "")).lower() != "user":
            continue
        content = item.get("content", "")
        if isinstance(content, str) and content.strip():
            messages.append(content.strip())
    current = (body.message or "").strip()
    if current:
        messages.append(current)
    return messages


def _api_key() -> str:
    return os.getenv("ANTHROPIC_API_KEY", "") or ""


async def _run_post_chat_extractors(user_messages: list[str], api_key: str) -> None:
    if not user_messages:
        return
    try:
        with get_db() as conn:
            await extract_body_data(user_messages, conn)
    except Exception:
        logger.exception("Background body extraction failed")
    if not api_key.strip():
        return
    try:
        with get_db() as conn:
            await extract_events(user_messages, conn, api_key)
    except Exception:
        logger.exception("Background event extraction failed")
    try:
        with get_db() as conn:
            await extract_facts(user_messages, conn, api_key)
    except Exception:
        logger.exception("Background fact extraction failed")


def _schedule_post_chat_extractors(user_messages: list[str], api_key: str) -> None:
    asyncio.create_task(_run_post_chat_extractors(user_messages, api_key))


def _meta_payload() -> str:
    return json.dumps(
        {"type": "meta", "event_saved": None, "facts_saved": []},
        ensure_ascii=False,
    )


@router.post("/chat", response_model=None)
async def chat_endpoint(
    body: ChatIn,
    accept: str | None = Header(None),
):
    message = (body.message or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message is required.")

    user_messages = _collect_user_messages(body)
    api_key = _api_key()

    with get_db() as conn:
        (
            summary,
            profile,
            facts,
            events,
            workouts_context,
            health_checkups_context,
        ) = _load_context(conn)

    system = build_system_context(
        summary=summary,
        profile=profile,
        facts=facts,
        events=events,
        workouts_context=workouts_context,
        health_checkups_context=health_checkups_context,
        current_page=body.current_page,
    )
    messages = history_to_messages(body.history)
    messages.append({"role": "user", "content": message})

    wants_stream = accept and "text/event-stream" in accept

    if wants_stream:

        async def generate():
            try:
                chunks: list[str] = []
                for delta in chat_stream(messages=messages, system=system, max_tokens=2048):
                    if delta:
                        chunks.append(delta)
                full_text = strip_internal_xml_tags("".join(chunks))
                if full_text:
                    yield f"data: {json.dumps({'type': 'delta', 'text': full_text}, ensure_ascii=False)}\n\n"
            except Exception as exc:
                yield f"data: {json.dumps({'type': 'error', 'text': str(exc)}, ensure_ascii=False)}\n\n"
                yield f"data: {json.dumps({'type': 'done'}, ensure_ascii=False)}\n\n"
                return

            yield f"data: {_meta_payload()}\n\n"
            yield f"data: {json.dumps({'type': 'done'}, ensure_ascii=False)}\n\n"
            _schedule_post_chat_extractors(user_messages, api_key)

        return StreamingResponse(
            generate(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
        )

    try:
        response_text = chat(messages=messages, system=system, max_tokens=2048)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Claude API error: {exc}") from exc

    response_text = strip_internal_xml_tags(response_text)

    _schedule_post_chat_extractors(user_messages, api_key)

    return ChatOut(
        response=response_text,
        event_saved=None,
        facts_saved=[],
    )
