"""Decision Memory layer — dilemmas + follow-up loop.

Surfaces:
- `GET    /api/dilemmas`                         — list everything
- `POST   /api/dilemmas`                         — manual create
- `PATCH  /api/dilemmas/{id}`                    — partial update
- `GET    /api/dilemmas/pending-followups`       — overdue follow-ups
- `POST   /api/dilemmas/{id}/followup-answer`    — close a follow-up
- `GET    /api/dilemmas/stats`                   — aggregate counters

The chat decision extractor (`services/decision_extractor.py`) does
its own direct INSERT to avoid HTTP-call latency from the background
task. This router is the source of truth for read paths and for
manual UI mutations.
"""

from __future__ import annotations

import json
import logging
from collections import Counter
from datetime import date, timedelta

from fastapi import APIRouter, HTTPException

from database import execute, fetch_all, fetch_one, get_db
from schemas import (
    DilemmaIn,
    DilemmaOut,
    DilemmaPatch,
    DilemmaStatsOut,
    FollowupAnswerIn,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# --- Helpers -----------------------------------------------------------------


def _parse_tags(raw: object | None) -> list[str]:
    """`tags` is stored as JSON in SQLite. Tolerate missing rows
    (None), legacy comma-separated strings, and malformed JSON by
    returning `[]` instead of raising — matches the `_parse_domains`
    convention in `routers/hypotheses.py`.
    """
    if raw is None:
        return []
    if isinstance(raw, list):
        return [str(x).strip() for x in raw if str(x).strip()]
    if isinstance(raw, str):
        s = raw.strip()
        if not s:
            return []
        try:
            parsed = json.loads(s)
            if isinstance(parsed, list):
                return [str(x).strip() for x in parsed if str(x).strip()]
        except json.JSONDecodeError:
            return [p.strip() for p in s.split(",") if p.strip()]
    return []


def _row_to_dilemma(row: dict) -> DilemmaOut:
    """SQLite Row → Pydantic. Pulls `tags` out of JSON storage and
    coerces `followup_done` from SQLite's INTEGER 0/1."""
    return DilemmaOut(
        id=int(row["id"]),
        title=str(row["title"]),
        description=row.get("description"),
        options=row.get("options"),
        analysis=row.get("analysis"),
        recommendation=row.get("recommendation"),
        status=str(row.get("status") or "open"),
        followup_due=row.get("followup_due"),
        followup_done=bool(row.get("followup_done") or 0),
        followup_answer=row.get("followup_answer"),
        decision_made=row.get("decision_made"),
        outcome=row.get("outcome"),
        tags=_parse_tags(row.get("tags")),
        created_at=row.get("created_at"),
    )


# All-columns SELECT used by every read path — keeps the column list
# defined once so additions don't have to be threaded through 4 routes.
_SELECT_COLUMNS = """
    id, title, description, options, analysis, recommendation,
    status, followup_due, followup_done, followup_answer,
    decision_made, outcome, tags, created_at
"""


def _default_followup_due() -> str:
    """ISO date for today + 14 days — matches the convention used by
    the decision extractor so manually-created and auto-extracted
    dilemmas surface in the advisor on the same cadence."""
    return (date.today() + timedelta(days=14)).isoformat()


# --- Endpoints ---------------------------------------------------------------


@router.get("/dilemmas", response_model=list[DilemmaOut])
def list_dilemmas() -> list[DilemmaOut]:
    with get_db() as conn:
        rows = fetch_all(
            conn,
            f"""
            SELECT {_SELECT_COLUMNS}
              FROM dilemmas
             ORDER BY datetime(created_at) DESC, id DESC
            """,
        )
    return [_row_to_dilemma(r) for r in rows]


@router.post("/dilemmas", response_model=DilemmaOut)
def create_dilemma(body: DilemmaIn) -> DilemmaOut:
    followup_due = body.followup_due or _default_followup_due()
    tags_json = json.dumps(body.tags or [], ensure_ascii=False)

    with get_db() as conn:
        new_id = execute(
            conn,
            """
            INSERT INTO dilemmas
                (title, description, options, analysis, recommendation,
                 status, decision_made, tags, followup_due)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                body.title.strip(),
                body.description,
                body.options,
                body.analysis,
                body.recommendation,
                body.status,
                body.decision_made,
                tags_json,
                followup_due,
            ),
        )
        row = fetch_one(
            conn,
            f"SELECT {_SELECT_COLUMNS} FROM dilemmas WHERE id = ?",
            (int(new_id),),
        )
    if row is None:
        raise HTTPException(status_code=500, detail="Failed to read created dilemma")
    return _row_to_dilemma(row)


@router.patch("/dilemmas/{dilemma_id}", response_model=DilemmaOut)
def update_dilemma(dilemma_id: int, body: DilemmaPatch) -> DilemmaOut:
    # Build the SET clause from only the fields the client actually
    # sent. `model_dump(exclude_unset=True)` so we never overwrite a
    # column with the default when the caller meant to leave it alone.
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        # Nothing to change — short-circuit with the current row so the
        # client always receives a fresh DilemmaOut.
        with get_db() as conn:
            row = fetch_one(
                conn,
                f"SELECT {_SELECT_COLUMNS} FROM dilemmas WHERE id = ?",
                (int(dilemma_id),),
            )
        if row is None:
            raise HTTPException(status_code=404, detail="Dilemma not found")
        return _row_to_dilemma(row)

    if "tags" in updates and updates["tags"] is not None:
        updates["tags"] = json.dumps(updates["tags"], ensure_ascii=False)

    set_clauses = [f"{col} = ?" for col in updates.keys()]
    params: list[object] = list(updates.values())
    params.append(int(dilemma_id))

    with get_db() as conn:
        existing = fetch_one(
            conn, "SELECT id FROM dilemmas WHERE id = ?", (int(dilemma_id),)
        )
        if existing is None:
            raise HTTPException(status_code=404, detail="Dilemma not found")

        execute(
            conn,
            f"UPDATE dilemmas SET {', '.join(set_clauses)} WHERE id = ?",
            tuple(params),
        )
        row = fetch_one(
            conn,
            f"SELECT {_SELECT_COLUMNS} FROM dilemmas WHERE id = ?",
            (int(dilemma_id),),
        )
    return _row_to_dilemma(row)  # type: ignore[arg-type]


@router.get("/dilemmas/pending-followups", response_model=list[DilemmaOut])
def list_pending_followups() -> list[DilemmaOut]:
    """Dilemmas whose follow-up window has opened (`followup_due <=
    today`) and that the user hasn't answered yet
    (`followup_done = 0`). The Overview AIR4 advisor uses this list
    as its tier-2 priority signal."""
    today_iso = date.today().isoformat()
    with get_db() as conn:
        rows = fetch_all(
            conn,
            f"""
            SELECT {_SELECT_COLUMNS}
              FROM dilemmas
             WHERE followup_due IS NOT NULL
               AND substr(followup_due, 1, 10) <= ?
               AND COALESCE(followup_done, 0) = 0
             ORDER BY substr(followup_due, 1, 10) ASC, id ASC
            """,
            (today_iso,),
        )
    return [_row_to_dilemma(r) for r in rows]


@router.post(
    "/dilemmas/{dilemma_id}/followup-answer",
    response_model=DilemmaOut,
)
def submit_followup_answer(
    dilemma_id: int, body: FollowupAnswerIn
) -> DilemmaOut:
    """User answer to "what actually happened?". Stores the answer
    verbatim in `followup_answer`, flips `followup_done = 1`, and
    mirrors the answer into `outcome` ONLY when `outcome` is still
    empty — preserves any manual edit the user may have made on the
    Dilemmas page."""
    answer = body.answer.strip()
    with get_db() as conn:
        existing = fetch_one(
            conn,
            "SELECT id, outcome FROM dilemmas WHERE id = ?",
            (int(dilemma_id),),
        )
        if existing is None:
            raise HTTPException(status_code=404, detail="Dilemma not found")

        current_outcome = existing.get("outcome") if isinstance(existing, dict) else None
        if current_outcome and str(current_outcome).strip():
            # User already wrote a custom outcome — keep it.
            execute(
                conn,
                """
                UPDATE dilemmas
                   SET followup_answer = ?,
                       followup_done   = 1
                 WHERE id = ?
                """,
                (answer, int(dilemma_id)),
            )
        else:
            execute(
                conn,
                """
                UPDATE dilemmas
                   SET followup_answer = ?,
                       followup_done   = 1,
                       outcome         = ?
                 WHERE id = ?
                """,
                (answer, answer, int(dilemma_id)),
            )
        row = fetch_one(
            conn,
            f"SELECT {_SELECT_COLUMNS} FROM dilemmas WHERE id = ?",
            (int(dilemma_id),),
        )
    return _row_to_dilemma(row)  # type: ignore[arg-type]


@router.get("/dilemmas/stats", response_model=DilemmaStatsOut)
def get_dilemma_stats() -> DilemmaStatsOut:
    """Aggregate counters for the Dilemmas page header and any
    future "decision health" widget. `followup_rate` is completed /
    eligible — eligible = dilemmas whose followup_due has passed."""
    today_iso = date.today().isoformat()
    with get_db() as conn:
        # Status counts in a single grouped query (cheap).
        status_rows = fetch_all(
            conn,
            "SELECT status, COUNT(*) AS n FROM dilemmas GROUP BY status",
        )
        followup_rows = fetch_all(
            conn,
            """
            SELECT
                COUNT(*) FILTER (WHERE COALESCE(followup_done, 0) = 1) AS completed,
                COUNT(*) FILTER (
                    WHERE followup_due IS NOT NULL
                      AND substr(followup_due, 1, 10) <= ?
                ) AS eligible,
                COUNT(*) FILTER (
                    WHERE followup_due IS NOT NULL
                      AND substr(followup_due, 1, 10) <= ?
                      AND COALESCE(followup_done, 0) = 0
                ) AS due
            FROM dilemmas
            """,
            (today_iso, today_iso),
        )
        tag_rows = fetch_all(
            conn,
            "SELECT tags FROM dilemmas WHERE tags IS NOT NULL AND tags <> ''",
        )

    by_status = {str(r["status"] or "open"): int(r["n"] or 0) for r in status_rows}
    total = sum(by_status.values())

    fu = followup_rows[0] if followup_rows else {}
    completed = int(fu.get("completed") or 0)
    eligible = int(fu.get("eligible") or 0)
    due = int(fu.get("due") or 0)
    followup_rate = (completed / eligible) if eligible > 0 else 0.0

    # Flatten all tag arrays and count occurrences for a leaderboard.
    tag_counter: Counter[str] = Counter()
    for r in tag_rows:
        for tag in _parse_tags(r.get("tags")):
            tag_counter[tag] += 1
    top_tags = [
        {"tag": tag, "count": count}
        for tag, count in tag_counter.most_common(5)
    ]

    return DilemmaStatsOut(
        total=total,
        open=by_status.get("open", 0),
        decided=by_status.get("decided", 0),
        closed=by_status.get("closed", 0),
        abandoned=by_status.get("abandoned", 0),
        followups_due=due,
        followups_completed=completed,
        followup_rate=round(followup_rate, 3),
        top_tags=top_tags,
    )
