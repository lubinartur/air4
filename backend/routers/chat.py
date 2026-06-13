from __future__ import annotations

import asyncio
import base64
import binascii
import json
import logging
import os
import time
from datetime import date
from typing import Any

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from fastapi import Query

from database import fetch_all, fetch_one, get_db
from routers.recommendation import air4_mode_instruction, normalize_air4_mode
from schemas import ChatAttachment, ChatHistoryOut, ChatIn, ChatMessageOut, ChatOut
from services.body_extractor import extract_body_data
from services.chat_history import fetch_recent_chat_messages, save_exchange
from services.interviewer import get_interview_question, get_pending_question
from services.llm_client import chat, chat_stream
from services.llm_client_shared import call_claude
from services.unified_extractor import extract_all
from services.workout_extractor import format_workout_footer
from services.prompts import (
    build_system_context,
    get_health_checkups_context,
    get_recent_chat_history,
    get_subscriptions_context,
    get_workouts_context,
    history_to_messages,
    search_relevant_events,
    strip_internal_xml_tags,
)
from services.obligation_from_chat import apply_obligation_confirmations
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
    # Recent events surfaced as the default memory block.
    #
    # • limit 15 (was 5) — top 5 was too small once the archive crossed
    #   a few extraction batches; with 770+ events even today's row
    #   could drop out of the prompt depending on extraction timing.
    # • date >= today - 30 days — fresh enough for "what's been
    #   happening" memory without flooding the prompt. Older specific
    #   events still reachable through `search_relevant_events`.
    # • Sort by `date DESC` (event date) then `created_at DESC` so an
    #   event the user logged about yesterday outranks one extracted
    #   first about something a week ago.
    events = fetch_all(
        conn,
        """
        SELECT date, title, description, domain, category, importance
        FROM events
        WHERE COALESCE(archived, 0) = 0
          AND date IS NOT NULL
          AND date >= date('now', '-30 days')
        ORDER BY date DESC, datetime(created_at) DESC, id DESC
        LIMIT 15
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


# Anthropic vision input limits (sonnet-4-5). 10 MB is well under
# what the API accepts but matches the FE upload cap so we reject
# oversized files before paying the encode/transit cost.
_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
_ALLOWED_IMAGE_TYPES = frozenset(
    {"image/jpeg", "image/png", "image/gif", "image/webp"}
)
_ALLOWED_DOC_TYPES = frozenset({"application/pdf"})


def _normalize_attachment(body: ChatIn) -> dict[str, str] | None:
    """Validate the optional file payload on ChatIn and return a dict
    suitable for both LLM forwarding and DB persistence, or None when
    no usable attachment was sent.

    Raises 400 on the cases where the user clearly *tried* to upload
    something invalid (unsupported type, malformed base64, oversized),
    so the UI can surface the reason instead of silently dropping it.
    """
    raw = (body.file_data or "").strip()
    if not raw:
        return None

    media_type = (body.file_type or "").strip().lower()
    if media_type not in _ALLOWED_IMAGE_TYPES and media_type not in _ALLOWED_DOC_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported attachment type: {media_type or 'unknown'}",
        )

    # Strip a `data:<mime>;base64,` prefix if the FE forgot to trim it.
    if raw.startswith("data:"):
        comma = raw.find(",")
        if comma == -1:
            raise HTTPException(status_code=400, detail="Malformed data URL")
        raw = raw[comma + 1 :]

    try:
        decoded = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(
            status_code=400, detail=f"Attachment is not valid base64: {exc}"
        ) from exc

    if len(decoded) > _MAX_ATTACHMENT_BYTES:
        raise HTTPException(
            status_code=413,
            detail=(
                f"Attachment too large ({len(decoded)} bytes, "
                f"max {_MAX_ATTACHMENT_BYTES})"
            ),
        )

    name = (body.file_name or "").strip() or None
    return {"data": raw, "media_type": media_type, "name": name}


def _attachment_to_block(attachment: dict[str, str]) -> dict[str, Any]:
    """Convert a normalized attachment dict to an Anthropic content
    block. PDFs use `document`, everything else (already validated as
    image/*) uses `image`."""
    media_type = attachment["media_type"]
    block_type = "document" if media_type in _ALLOWED_DOC_TYPES else "image"
    return {
        "type": block_type,
        "source": {
            "type": "base64",
            "media_type": media_type,
            "data": attachment["data"],
        },
    }


def _build_user_turn(message: str, attachment: dict[str, str] | None) -> dict[str, Any]:
    """Compose the current user message as either a plain-text turn or
    a multi-block turn with the attachment placed *before* the text so
    Claude is grounded in the file when answering."""
    if not attachment:
        return {"role": "user", "content": message}
    return {
        "role": "user",
        "content": [
            _attachment_to_block(attachment),
            {"type": "text", "text": message},
        ],
    }


async def _run_post_chat_extractors(
    user_messages: list[str], api_key: str
) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    """Run post-chat side effects.

    Returns a tuple of:
      • recurring rows created/updated by fact extraction
        (subscriptions / obligations), surfaced as meta so the Finance
        page can refetch immediately.
      • the workout row inserted by `extract_workout`, or ``None`` —
        used by the chat router to append a `_Записал: …_` footer to
        the assistant message.

    Awaited before persistence so the workout footer can be folded into
    the message saved in `chat_messages` (and streamed as one last
    delta). Failures inside any extractor are logged and swallowed — a
    side-effect crash must never break the user's chat reply.
    """
    recurring_from_facts: list[dict[str, Any]] = []
    saved_workout: dict[str, Any] | None = None
    if not user_messages:
        return recurring_from_facts, saved_workout
    # body_extractor stays separate — it's rule-based (no LLM), so it
    # doesn't contribute to the 429 problem and runs regardless of the
    # API key being set.
    try:
        with get_db() as conn:
            await extract_body_data(user_messages, conn)
    except Exception:
        logger.exception("Background body extraction failed")
    if not api_key.strip():
        return recurring_from_facts, saved_workout
    # Unified extractor: ONE Haiku call replaces the previous four
    # sequential LLM calls (events + workout + facts + decisions), which
    # were tripping Anthropic 429 rate limits. Wrapped so a failure here
    # never breaks the user's chat reply.
    try:
        with get_db() as conn:
            result = await extract_all(user_messages, conn, api_key)
        saved_workout = result.get("workout")
        recurring_from_facts = result.get("recurring_updated") or []
    except Exception:
        logger.exception("Background unified extraction failed")
    return recurring_from_facts, saved_workout


def _merge_recurring_updates(
    correction_updates: list[dict[str, Any]],
    extractor_updates: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Combine subscription_updater corrections with fact_extractor
    creates/updates. Corrections win on duplicate (type, id) pairs."""
    if not extractor_updates:
        return list(correction_updates)
    if not correction_updates:
        return list(extractor_updates)
    seen = {(u.get("type"), u.get("id")) for u in correction_updates}
    merged = list(correction_updates)
    for item in extractor_updates:
        key = (item.get("type"), item.get("id"))
        if key in seen:
            continue
        merged.append(item)
        seen.add(key)
    return merged


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


def _apply_obligation_confirmations_safely(assistant_text: str) -> list[dict[str, Any]]:
    """When AIR4 says it added an obligation, persist it for real."""
    text = (assistant_text or "").strip()
    logger.info(
        "chat: apply_obligation_confirmations called len=%d preview=%r",
        len(text),
        text[:200],
    )
    if not text:
        logger.info("chat: empty assistant_text, skipping obligation parse")
        return []
    try:
        with get_db() as conn:
            result = apply_obligation_confirmations(conn, text)
        logger.info(
            "chat: apply_obligation_confirmations returned %d update(s): %s",
            len(result),
            [(u.get("type"), u.get("id"), u.get("name"), u.get("action")) for u in result],
        )
        return result
    except Exception:
        logger.exception("Obligation confirmation step failed")
        return []


def _persist_exchange(
    user_message: str,
    assistant_message: str,
    page: str | None,
    attachment: dict[str, str] | None = None,
) -> None:
    try:
        with get_db() as conn:
            save_exchange(
                conn,
                user_message=user_message,
                assistant_message=assistant_message,
                page=page,
                attachment=attachment,
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
    attachment = _normalize_attachment(body)
    if not message and not attachment:
        raise HTTPException(status_code=400, detail="Message is required.")
    # Claude rejects a content array with zero text blocks. When the
    # user sent only a file, give the model a minimal text prompt so
    # the multimodal turn is still valid; the FE button is disabled
    # in this state but we belt-and-suspenders it here.
    if not message and attachment:
        message = "(см. вложение)"
    if attachment:
        logger.info(
            "chat: attachment received name=%r type=%s b64_len=%d",
            attachment.get("name"),
            attachment.get("media_type"),
            len(attachment.get("data") or ""),
        )

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
        # Semantic-ish recall: search the whole archive for events that
        # match keywords in the current user turn. Catches references
        # to older events that fell out of the 30-day recent window
        # (e.g. "помнишь про фотку для ид карты — отметь что сделал").
        relevant_events = search_relevant_events(conn, message, limit=5)
        logger.info(
            "chat: loaded %d recent events + %d relevant matches for message=%r",
            len(events),
            len(relevant_events),
            message[:80],
        )

    system = build_system_context(
        summary=summary,
        profile=profile,
        facts=facts,
        events=events,
        workouts_context=workouts_context,
        health_checkups_context=health_checkups_context,
        subscriptions_context=subscriptions_context,
        current_page=body.current_page,
        relevant_events=relevant_events,
    )
    # Append the AIR4 engagement-mode instruction (quiet/active/jarvis).
    # `normal` resolves to an empty string, leaving the prompt unchanged.
    mode = normalize_air4_mode(profile.get("air4_mode") if profile else None)
    mode_suffix = air4_mode_instruction(mode)
    if mode_suffix:
        system = f"{system}\n\n{mode_suffix}"
    messages: list[dict[str, Any]] = list(llm_history)
    messages.append(_build_user_turn(message, attachment))

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
            obligation_updates = _apply_obligation_confirmations_safely(full_text)
            confirmation = format_confirmation(updates + obligation_updates)
            if confirmation:
                yield f"data: {json.dumps({'type': 'delta', 'text': confirmation}, ensure_ascii=False)}\n\n"

            # Run extractors before persistence so the workout footer
            # (if any) is folded into the same `chat_messages` row that
            # we save below — and yielded as one final delta so the FE
            # sees it without a reload.
            fact_recurring, saved_workout = await _run_post_chat_extractors(
                user_messages, api_key
            )
            workout_footer = format_workout_footer(saved_workout)
            if workout_footer:
                yield f"data: {json.dumps({'type': 'delta', 'text': workout_footer}, ensure_ascii=False)}\n\n"

            assistant_text = (
                (full_text or "") + (confirmation or "") + (workout_footer or "")
            )
            _persist_exchange(
                message, assistant_text, body.current_page, attachment=attachment
            )

            all_updates = _merge_recurring_updates(
                updates,
                _merge_recurring_updates(obligation_updates, fact_recurring),
            )

            yield f"data: {_meta_payload(all_updates)}\n\n"
            yield f"data: {json.dumps({'type': 'done'}, ensure_ascii=False)}\n\n"

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
    obligation_updates = _apply_obligation_confirmations_safely(response_text)
    response_text = response_text + format_confirmation(
        updates + obligation_updates
    )

    # Extractors run before persistence so the workout footer (if any)
    # is part of the response payload AND the saved chat_messages row.
    fact_recurring, saved_workout = await _run_post_chat_extractors(
        user_messages, api_key
    )
    response_text = response_text + format_workout_footer(saved_workout)

    _persist_exchange(
        message, response_text, body.current_page, attachment=attachment
    )
    all_updates = _merge_recurring_updates(
        updates,
        _merge_recurring_updates(obligation_updates, fact_recurring),
    )

    return ChatOut(
        response=response_text,
        event_saved=None,
        facts_saved=[],
        recurring_updated=all_updates,
    )


def _row_to_attachment(row: dict[str, Any]) -> ChatAttachment | None:
    """Build a ChatAttachment from a chat_messages row, or None when
    the row has no attachment columns populated. Tolerant of legacy
    rows missing the columns entirely."""
    data = row.get("attachment_data")
    media_type = row.get("attachment_type")
    if not data or not media_type:
        return None
    return ChatAttachment(
        data=str(data),
        media_type=str(media_type),
        name=(str(row["attachment_name"]) if row.get("attachment_name") else None),
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
            attachment=_row_to_attachment(r),
        )
        for r in rows
    ]
    return ChatHistoryOut(messages=messages)


# --- Morning Brief -------------------------------------------------------
# When the user opens the app and hasn't written anything yet today, AIR4
# speaks first with one short, concrete observation. Generated via Claude
# Haiku and cached for an hour so repeated opens don't re-hit the LLM.


class MorningBriefOut(BaseModel):
    should_show: bool
    message: str | None = None


_MORNING_BRIEF_TTL_SECONDS = 60 * 60
_morning_brief_cache: dict[str, Any] = {}

_MORNING_BRIEF_PROMPT = (
    "Ты AIR4. Пользователь только что открыл приложение утром.\n"
    "Напиши короткое приветствие — 2-3 предложения максимум.\n"
    "Не 'доброе утро' и не общие слова.\n"
    "Одна конкретная вещь которую ты заметил + один вопрос или следующий шаг.\n"
    "Тон зависит от air4_mode: jarvis=прямой и конкретный, active=проактивный, "
    "normal=спокойный, quiet=минимальный.\n"
    "Данные: {context}"
)


def _build_morning_context(conn) -> str:
    """Compact snapshot for the morning brief prompt."""
    profile = fetch_one(conn, "SELECT * FROM user_profile WHERE id = 1")
    mode = normalize_air4_mode(profile.get("air4_mode") if profile else None)
    name = (profile.get("name") if profile else None) or "—"
    goals = (profile.get("goals") if profile else None) or "—"

    events = fetch_all(
        conn,
        """
        SELECT date, title, domain
        FROM events
        WHERE COALESCE(archived, 0) = 0 AND date IS NOT NULL
        ORDER BY date DESC, datetime(created_at) DESC, id DESC
        LIMIT 5
        """,
    )
    projects = fetch_all(
        conn,
        """
        SELECT name, status
        FROM projects
        WHERE status = 'active'
        ORDER BY datetime(updated_at) DESC
        LIMIT 8
        """,
    )
    workout = fetch_one(
        conn,
        "SELECT date, type, duration FROM workouts ORDER BY date DESC, id DESC LIMIT 1",
    )
    summary = load_summary(conn)

    lines: list[str] = [
        f"Режим (air4_mode): {mode}",
        f"Имя: {name}",
        f"Цели: {goals}",
    ]

    if events:
        ev = "; ".join(
            f"{e.get('date')} [{e.get('domain') or '—'}] {e.get('title') or ''}".strip()
            for e in events
        )
        lines.append(f"Последние события: {ev}")
    else:
        lines.append("Последние события: нет.")

    if projects:
        pr = "; ".join(
            f"{p.get('name')} ({p.get('status')})" for p in projects
        )
        lines.append(f"Активные проекты: {pr}")
    else:
        lines.append("Активные проекты: нет.")

    if workout:
        last_workout_date = str(workout.get("date") or "").strip()
        # Compute the gap in days explicitly so AIR4 doesn't have to infer
        # "how long ago" from a raw date. Tolerant of malformed dates —
        # falls back to just the date string if parsing fails.
        try:
            days_ago = (date.today() - date.fromisoformat(last_workout_date[:10])).days
            ago_part = f"{days_ago} дней назад, "
        except ValueError:
            ago_part = ""
        lines.append(
            f"последняя тренировка: {last_workout_date} "
            f"({ago_part}{workout.get('type') or '—'}, {workout.get('duration') or '—'} мин)"
        )
    else:
        lines.append("Последняя тренировка: нет данных.")

    total_spent = float(getattr(summary, "total_spent", 0) or 0)
    total_income = float(getattr(summary, "total_income", 0) or 0)
    other = getattr(summary, "other_incoming", None)
    other_amt = float(getattr(other, "amount", 0) or 0) if other else 0.0
    income = total_income + other_amt
    if total_spent > 0 or income > 0:
        if income > 0:
            free_capital = income - total_spent
            lines.append(
                f"Финансы: потрачено €{total_spent:.2f}, свободно €{free_capital:.2f}"
            )
        else:
            lines.append(f"Финансы: потрачено €{total_spent:.2f}")
    else:
        lines.append("Финансы: нет данных за цикл.")

    return "\n".join(lines)


async def _maybe_interview_question(conn) -> str | None:
    """Occasionally surface an interview question inside the morning brief.

    Reuses the interview service, which enforces a 3-day cooldown
    (`COOLDOWN_DAYS`) based on the most recent `interview_answers` row —
    so a question is only generated once the last one is older than 3
    days. A previously generated but still-unanswered question is reused
    instead of creating a new one. Never raises — a failure here just
    means the brief ships without a question.
    """
    try:
        pending = get_pending_question(conn)
        if pending:
            return pending.get("question")
        return await get_interview_question(conn, _api_key())
    except Exception:
        logger.exception("morning-brief: interview question lookup failed")
        return None


@router.get("/chat/morning-brief", response_model=MorningBriefOut)
async def morning_brief() -> MorningBriefOut:
    """AIR4 speaks first if the user hasn't written anything today.

    The "wrote today" check is always live (never cached) so the brief
    stops showing the moment the user sends a message. Only the generated
    text is cached, for an hour.
    """
    with get_db() as conn:
        row = fetch_one(
            conn,
            "SELECT COUNT(*) AS n FROM chat_messages "
            "WHERE role = 'user' AND date(created_at) = date('now')",
        )
    if row and int(row.get("n") or 0) > 0:
        return MorningBriefOut(should_show=False)

    # Date-stamped cache key: a new day automatically invalidates the
    # previous day's brief, and an in-memory dict means a server restart
    # drops the cache entirely.
    cache_key = f"morning_brief_{date.today()}"
    now = time.time()
    entry = _morning_brief_cache.get(cache_key)
    if entry and now < entry.get("expires_at", 0.0):
        return MorningBriefOut(should_show=True, message=entry["message"])

    # NB: the workouts/profile/etc. snapshot below is rebuilt on every
    # cache miss — it is never cached separately.
    with get_db() as conn:
        context = _build_morning_context(conn)
        interview_question = await _maybe_interview_question(conn)

    prompt = _MORNING_BRIEF_PROMPT.format(context=context)
    if interview_question:
        prompt += (
            f"\n\nВ конце добавь один вопрос: {interview_question}\n"
            "Вплети его естественно, не как анкету."
        )
    try:
        message = (await call_claude(prompt, max_tokens=300)).strip()
    except Exception:
        logger.exception("morning-brief: LLM call failed")
        message = ""

    if not message:
        # Nothing useful to say (no key or model error) — stay silent
        # rather than injecting an empty bubble.
        return MorningBriefOut(should_show=False)

    _morning_brief_cache[cache_key] = {
        "message": message,
        "expires_at": now + _MORNING_BRIEF_TTL_SECONDS,
    }
    return MorningBriefOut(should_show=True, message=message)
