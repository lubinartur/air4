from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from database import execute, fetch_all, fetch_one, get_db
from schemas import SpaceIn, SpaceOut, SpaceSuggestIn, SpaceSuggestOut
from services.llm_client import parse_json_object
from services.llm_client_shared import call_claude

logger = logging.getLogger("spaces")

router = APIRouter()

SUGGEST_PROMPT = """Проанализируй последние сообщения пользователя.
Если есть явная повторяющаяся тема (тренировки, финансы, проект, здоровье) — предложи Space.
Ответь JSON: {"suggest": true, "name": "Performance", "reason": "ты уже 3 раза упомянул тренировки"}
Если темы нет — {"suggest": false}

Правила:
- name — короткое название Space на английском (1-2 слова): Performance, Finance, Health, Project
- reason — одно предложение на русском, обращение на «ты»
- Отвечай только JSON, без markdown"""


def _space_count(conn) -> int:
    row = fetch_one(conn, "SELECT COUNT(*) AS cnt FROM spaces")
    return int(row["cnt"] if row else 0)


def _format_messages(messages: list) -> str:
    lines: list[str] = []
    for m in messages[-5:]:
        role = str(m.role or "").strip().lower()
        label = "Пользователь" if role == "user" else "AIRCH"
        content = str(m.content or "").strip()
        if content:
            lines.append(f"{label}: {content}")
    return "\n\n".join(lines)


@router.post("/spaces/suggest", response_model=SpaceSuggestOut)
async def suggest_space(body: SpaceSuggestIn) -> SpaceSuggestOut:
    with get_db() as conn:
        if _space_count(conn) > 0:
            return SpaceSuggestOut(suggest=False)

    messages = body.messages[-5:]
    if not any(str(m.role or "").strip().lower() == "user" for m in messages):
        return SpaceSuggestOut(suggest=False)

    transcript = _format_messages(messages)
    if not transcript.strip():
        return SpaceSuggestOut(suggest=False)

    prompt = f"{SUGGEST_PROMPT}\n\nСообщения:\n{transcript}"

    try:
        raw = (await call_claude(prompt, max_tokens=256)).strip()
        parsed = parse_json_object(raw)
    except Exception:
        logger.exception("spaces: suggest LLM call failed")
        return SpaceSuggestOut(suggest=False)

    if not parsed.get("suggest"):
        return SpaceSuggestOut(suggest=False)

    name = str(parsed.get("name") or "").strip()
    reason = str(parsed.get("reason") or "").strip()
    if not name or not reason:
        return SpaceSuggestOut(suggest=False)

    return SpaceSuggestOut(suggest=True, name=name, reason=reason)


@router.get("/spaces", response_model=list[SpaceOut])
def list_spaces() -> list[SpaceOut]:
    with get_db() as conn:
        rows = fetch_all(
            conn,
            """
            SELECT id, name, icon, created_at, last_active
            FROM spaces
            ORDER BY datetime(COALESCE(last_active, created_at)) DESC, id DESC
            """,
        )
    return [
        SpaceOut(
            id=int(row["id"]),
            name=str(row["name"]),
            icon=str(row.get("icon") or "✦"),
            created_at=row.get("created_at"),
            last_active=row.get("last_active"),
        )
        for row in rows
    ]


@router.post("/spaces", response_model=SpaceOut, status_code=201)
def create_space(body: SpaceIn) -> SpaceOut:
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")

    icon = (body.icon or "✦").strip() or "✦"

    with get_db() as conn:
        space_id = execute(
            conn,
            """
            INSERT INTO spaces (name, icon, last_active)
            VALUES (?, ?, datetime('now'))
            """,
            (name, icon),
        )
        row = fetch_one(
            conn,
            """
            SELECT id, name, icon, created_at, last_active
            FROM spaces
            WHERE id = ?
            """,
            (space_id,),
        )

    if row is None:
        raise HTTPException(status_code=500, detail="failed to persist space")

    return SpaceOut(
        id=int(row["id"]),
        name=str(row["name"]),
        icon=str(row.get("icon") or "✦"),
        created_at=row.get("created_at"),
        last_active=row.get("last_active"),
    )
