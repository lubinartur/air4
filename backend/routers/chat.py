from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import StreamingResponse

from fastapi import Query

from database import fetch_all, fetch_one, get_db
from schemas import ChatHistoryOut, ChatIn, ChatMessageOut, ChatOut
from services.body_extractor import extract_body_data
from services.chat_history import fetch_recent_chat_messages, save_exchange
from services.event_extractor import extract_events
from services.fact_extractor import extract_facts
from services.llm_client import chat, chat_stream
from services.prompts import (
    build_system_context,
    get_health_checkups_context,
    get_recent_chat_history,
    get_subscriptions_context,
    get_workouts_context,
    history_to_messages,
    strip_internal_xml_tags,
)
from services.subscription_updater import (
    apply_recurring_corrections,
    format_confirmation,
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
    subscriptions_context = get_subscriptions_context(conn)
    return (
        summary,
        profile,
        facts,
        events,
        workouts_context,
        health_checkups_context,
        subscriptions_context,
    )


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


def _meta_payload(recurring_updated: list[dict[str, Any]] | None = None) -> str:
    return json.dumps(
        {
            "type": "meta",
            "event_saved": None,
            "facts_saved": [],
            "recurring_updated": recurring_updated or [],
        },
        ensure_ascii=False,
    )


def _apply_corrections_safely(message: str) -> list[dict[str, Any]]:
    try:
        with get_db() as conn:
            return apply_recurring_corrections(conn, message)
    except Exception:
        logger.exception("Recurring correction step failed")
        return []


def _persist_exchange(
    user_message: str, assistant_message: str, page: str | None
) -> None:
    try:
        with get_db() as conn:
            save_exchange(
                conn,
                user_message=user_message,
                assistant_message=assistant_message,
                page=page,
            )
    except Exception:
        logger.exception("Failed to persist chat exchange")


def _build_llm_history(
    body_history: list[dict[str, Any]] | None, conn
) -> list[dict[str, str]]:
    """Backend DB is the source of truth for cross-session memory.

    Fall back to the request's `history` payload only when the DB has no
    prior messages — e.g. on first run after wiping the database.
    """
    db_history = get_recent_chat_history(conn, limit=10)
    if db_history:
        return db_history
    return history_to_messages(body_history or [])


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
            subscriptions_context,
        ) = _load_context(conn)
        llm_history = _build_llm_history(body.history, conn)

    system = build_system_context(
        summary=summary,
        profile=profile,
        facts=facts,
        events=events,
        workouts_context=workouts_context,
        health_checkups_context=health_checkups_context,
        subscriptions_context=subscriptions_context,
        current_page=body.current_page,
    )
    messages: list[dict[str, str]] = list(llm_history)
    messages.append({"role": "user", "content": message})

    wants_stream = accept and "text/event-stream" in accept

    if wants_stream:

        async def generate():
            chunks: list[str] = []
            # `chat_stream` is a sync generator wrapping a blocking HTTP
            # stream from the Anthropic SDK. If we iterate it inline with
            # `for delta in ...`, each `next()` call blocks the asyncio
            # event loop, so uvicorn can't flush the previously-yielded
            # SSE frame until the entire LLM response is done — which
            # defeats streaming. We pull each chunk on a worker thread via
            # `asyncio.to_thread` so the loop is free to flush between
            # yields. XML stripping is still applied to the full buffered
            # text before persistence; Claude emits `<thinking>` blocks
            # atomically inside single deltas in current usage, so
            # per-chunk leakage in the rendered stream is rare. If that
            # changes, switch to a streaming XML state machine here.
            sentinel = object()
            stream_iter = chat_stream(
                messages=messages, system=system, max_tokens=2048
            )

            def _next_chunk():
                try:
                    return next(stream_iter)
                except StopIteration:
                    return sentinel

            try:
                while True:
                    delta = await asyncio.to_thread(_next_chunk)
                    if delta is sentinel:
                        break
                    if not delta:
                        continue
                    chunks.append(delta)
                    yield (
                        "data: "
                        + json.dumps(
                            {"type": "delta", "text": delta},
                            ensure_ascii=False,
                        )
                        + "\n\n"
                    )
            except Exception as exc:
                yield f"data: {json.dumps({'type': 'error', 'text': str(exc)}, ensure_ascii=False)}\n\n"
                yield f"data: {json.dumps({'type': 'done'}, ensure_ascii=False)}\n\n"
                return
            finally:
                close = getattr(stream_iter, "close", None)
                if callable(close):
                    try:
                        close()
                    except Exception:
                        pass

            full_text = strip_internal_xml_tags("".join(chunks))

            updates = _apply_corrections_safely(message)
            confirmation = format_confirmation(updates)
            if confirmation:
                yield f"data: {json.dumps({'type': 'delta', 'text': confirmation}, ensure_ascii=False)}\n\n"

            assistant_text = (full_text or "") + (confirmation or "")
            _persist_exchange(message, assistant_text, body.current_page)

            yield f"data: {_meta_payload(updates)}\n\n"
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

    updates = _apply_corrections_safely(message)
    response_text = response_text + format_confirmation(updates)

    _persist_exchange(message, response_text, body.current_page)
    _schedule_post_chat_extractors(user_messages, api_key)

    return ChatOut(
        response=response_text,
        event_saved=None,
        facts_saved=[],
        recurring_updated=updates,
    )


@router.get("/chat/history", response_model=ChatHistoryOut)
def chat_history(limit: int = Query(50, ge=1, le=500)) -> ChatHistoryOut:
    """Return recent chat messages in chronological order (oldest first).

    Used by the frontend to rehydrate the chat panel on mount so the user
    sees prior exchanges instead of an empty thread.
    """
    with get_db() as conn:
        rows = fetch_recent_chat_messages(conn, limit=limit)
    messages = [
        ChatMessageOut(
            id=int(r["id"]),
            role=str(r.get("role") or "user"),
            content=str(r.get("content") or ""),
            page=(str(r["page"]) if r.get("page") is not None else None),
            created_at=(
                str(r["created_at"]) if r.get("created_at") is not None else None
            ),
        )
        for r in rows
    ]
    return ChatHistoryOut(messages=messages)
