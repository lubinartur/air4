from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from database import execute, fetch_all, fetch_one, get_db
from routers.profile import _parse_goals
from schemas import (
    ActiveSessionOut,
    ProjectDetailOut,
    ProjectGoalsIn,
    ProjectIn,
    ProjectLogIn,
    ProjectLogOut,
    ProjectOut,
    ProjectStatusIn,
    ProjectTodoIn,
    ProjectTodoOut,
    ProjectTodosListOut,
    ResolvedGoal,
    SessionStartOut,
    SessionStopIn,
)

logger = logging.getLogger("projects")


ALLOWED_PROJECT_STATUSES = {"active", "paused", "stalled", "completed", "archived"}

router = APIRouter()


SESSION_START = "session_start"
SESSION = "session"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    s = str(value).strip()
    if not s:
        return None
    s = s.replace("T", " ").replace("Z", "")
    for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _project_row(conn, project_id: int) -> dict:
    row = fetch_one(
        conn,
        """
        SELECT id, name, description, status, priority, started_at,
               goal_keys, created_at, updated_at
        FROM projects
        WHERE id = ?
        """,
        (project_id,),
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return row


def _logs_for_project(conn, project_id: int) -> list[dict]:
    return fetch_all(
        conn,
        """
        SELECT id, note, log_type, duration_minutes, source, created_at
        FROM project_logs
        WHERE project_id = ?
        ORDER BY datetime(created_at) DESC, id DESC
        """,
        (project_id,),
    )


def _detect_active_session(logs: list[dict]) -> dict | None:
    """Return latest unfinished session_start (no session log after it), else None.

    Logs are expected to be ordered DESC by time.
    """
    for log in logs:
        log_type = log.get("log_type")
        if log_type == SESSION:
            return None
        if log_type == SESSION_START:
            return log
    return None


def _total_minutes(conn, project_id: int) -> int:
    row = fetch_one(
        conn,
        """
        SELECT COALESCE(SUM(duration_minutes), 0) AS total
        FROM project_logs
        WHERE project_id = ? AND log_type = ?
        """,
        (project_id, SESSION),
    )
    return int(row["total"] if row and row["total"] is not None else 0)


def _touch_project(conn, project_id: int) -> None:
    execute(
        conn,
        "UPDATE projects SET updated_at = datetime('now') WHERE id = ?",
        (project_id,),
    )


def _parse_goal_keys(raw: object) -> list[str]:
    """Decode the `goal_keys` JSON column. NULL → [], malformed → []
    (logged), and falsy/empty strings inside the array are dropped so
    a fact-extractor bug can't smuggle empty pills into the UI."""
    if not raw:
        return []
    try:
        decoded = json.loads(str(raw))
    except (TypeError, ValueError, json.JSONDecodeError):
        logger.warning("projects: malformed goal_keys JSON: %r", raw)
        return []
    if not isinstance(decoded, list):
        return []
    cleaned: list[str] = []
    seen: set[str] = set()
    for item in decoded:
        s = str(item or "").strip()
        if not s or s in seen:
            continue
        cleaned.append(s)
        seen.add(s)
    return cleaned


def _build_goal_index(conn) -> dict[str, ResolvedGoal]:
    """Build `{goal_key → ResolvedGoal}` covering both sources used by
    `/api/goals`. Called once per request so list_projects doesn't
    re-query for every row."""
    index: dict[str, ResolvedGoal] = {}

    # Profile goals: keyed by `profile:<idx>` matching goals router.
    profile_row = fetch_one(conn, "SELECT goals FROM user_profile WHERE id = 1")
    profile_titles = _parse_goals(
        profile_row.get("goals") if profile_row else None
    )
    for idx, title in enumerate(profile_titles, start=1):
        key = f"profile:{idx}"
        index[key] = ResolvedGoal(key=key, title=title, source="profile")

    # Fact-derived goals: keyed by `user_facts.key`. Same WHERE filter
    # as /api/goals so the two stay aligned; last-write-wins by id DESC
    # means the most recent value of a fact key is the one we resolve.
    fact_rows = fetch_all(
        conn,
        """
        SELECT key, value
        FROM user_facts
        WHERE LOWER(key) LIKE '%goal%'
           OR LOWER(key) LIKE '%target%'
           OR LOWER(key) LIKE '%wish%'
        ORDER BY datetime(updated_at) DESC, id DESC
        """,
    )
    for row in fact_rows:
        key = str(row.get("key") or "").strip()
        if not key or key in index:
            continue
        title = str(row.get("value") or "").strip() or None
        index[key] = ResolvedGoal(key=key, title=title, source="facts")
    return index


def _resolve_goals(
    goal_keys: list[str], goal_index: dict[str, ResolvedGoal]
) -> list[ResolvedGoal]:
    """Same length + order as `goal_keys`. Orphans (key with no entry
    in the index) come back with `title=None` so the FE can show a
    "deleted goal" pill instead of silently hiding the link."""
    resolved: list[ResolvedGoal] = []
    for key in goal_keys:
        hit = goal_index.get(key)
        if hit is None:
            resolved.append(ResolvedGoal(key=key, title=None, source=None))
        else:
            resolved.append(hit)
    return resolved


def _project_row_to_out(
    row: dict, *, goal_index: dict[str, ResolvedGoal]
) -> ProjectOut:
    goal_keys = _parse_goal_keys(row.get("goal_keys"))
    return ProjectOut(
        id=int(row["id"]),
        name=str(row["name"]),
        description=row.get("description"),
        status=row.get("status") or "active",
        priority=int(row.get("priority") or 2),
        started_at=row.get("started_at"),
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
        total_sessions_minutes=int(row.get("total_sessions_minutes") or 0),
        goal_keys=goal_keys,
        goals=_resolve_goals(goal_keys, goal_index),
    )


@router.post("/projects", response_model=ProjectOut, status_code=201)
def create_project(body: ProjectIn) -> ProjectOut:
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")

    status = (body.status or "active").strip().lower() or "active"
    if status not in ALLOWED_PROJECT_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"status must be one of: {', '.join(sorted(ALLOWED_PROJECT_STATUSES))}",
        )

    description = (body.description or "").strip() or None
    priority = body.priority if isinstance(body.priority, int) else 2

    now_iso = _utc_now_iso()
    with get_db() as conn:
        project_id = execute(
            conn,
            """
            INSERT INTO projects
                (name, description, status, priority, started_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (name, description, status, priority, now_iso, now_iso, now_iso),
        )
        row = fetch_one(
            conn,
            """
            SELECT id, name, description, status, priority, started_at,
                   goal_keys, created_at, updated_at
            FROM projects
            WHERE id = ?
            """,
            (project_id,),
        )
        if row is None:
            raise HTTPException(status_code=500, detail="failed to persist project")
        goal_index = _build_goal_index(conn)

    return _project_row_to_out(row, goal_index=goal_index)


@router.get("/projects", response_model=list[ProjectOut])
def list_projects() -> list[ProjectOut]:
    with get_db() as conn:
        # Previously a correlated `SELECT SUM(...) FROM project_logs ...`
        # ran once per project row (N+1). A single LEFT JOIN against a
        # pre-aggregated derived table folds it into one pass and lets
        # SQLite use `idx_project_logs_project` directly.
        rows = fetch_all(
            conn,
            """
            SELECT
              p.id, p.name, p.description, p.status, p.priority,
              p.started_at, p.goal_keys, p.created_at, p.updated_at,
              COALESCE(s.total_sessions_minutes, 0) AS total_sessions_minutes
            FROM projects p
            LEFT JOIN (
              SELECT project_id, SUM(duration_minutes) AS total_sessions_minutes
              FROM project_logs
              WHERE log_type = 'session'
              GROUP BY project_id
            ) s ON s.project_id = p.id
            ORDER BY
              CASE p.status
                WHEN 'active' THEN 0
                WHEN 'paused' THEN 1
                WHEN 'stalled' THEN 2
                WHEN 'completed' THEN 3
                WHEN 'archived' THEN 4
                ELSE 99
              END,
              datetime(p.updated_at) DESC,
              p.id DESC
            """,
        )
        goal_index = _build_goal_index(conn)
    return [_project_row_to_out(r, goal_index=goal_index) for r in rows]


@router.get("/projects/{project_id}", response_model=ProjectDetailOut)
def get_project(project_id: int) -> ProjectDetailOut:
    with get_db() as conn:
        project = _project_row(conn, project_id)
        logs = _logs_for_project(conn, project_id)
        active = _detect_active_session(logs)
        total_minutes = _total_minutes(conn, project_id)
        goal_index = _build_goal_index(conn)

    goal_keys = _parse_goal_keys(project.get("goal_keys"))
    return ProjectDetailOut(
        id=int(project["id"]),
        name=str(project["name"]),
        description=project.get("description"),
        status=project.get("status") or "active",
        priority=int(project.get("priority") or 2),
        started_at=project.get("started_at"),
        created_at=project.get("created_at"),
        updated_at=project.get("updated_at"),
        goal_keys=goal_keys,
        goals=_resolve_goals(goal_keys, goal_index),
        logs=[ProjectLogOut(**log) for log in logs],
        total_sessions_minutes=total_minutes,
        active_session=(
            ActiveSessionOut(started_at=str(active["created_at"]))
            if active and active.get("created_at")
            else None
        ),
    )


@router.put("/projects/{project_id}", response_model=ProjectOut)
def update_project(project_id: int, body: ProjectStatusIn) -> ProjectOut:
    """Update project fields (currently status only)."""
    status = (body.status or "").strip().lower()
    if status not in ALLOWED_PROJECT_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"status must be one of: {', '.join(sorted(ALLOWED_PROJECT_STATUSES))}",
        )

    with get_db() as conn:
        _project_row(conn, project_id)
        execute(
            conn,
            """
            UPDATE projects
            SET status = ?, updated_at = datetime('now')
            WHERE id = ?
            """,
            (status, project_id),
        )
        row = fetch_one(
            conn,
            """
            SELECT
              p.id, p.name, p.description, p.status, p.priority,
              p.started_at, p.goal_keys, p.created_at, p.updated_at,
              COALESCE(s.total_sessions_minutes, 0) AS total_sessions_minutes
            FROM projects p
            LEFT JOIN (
              SELECT project_id, SUM(duration_minutes) AS total_sessions_minutes
              FROM project_logs
              WHERE log_type = 'session'
              GROUP BY project_id
            ) s ON s.project_id = p.id
            WHERE p.id = ?
            """,
            (project_id,),
        )
        if row is None:
            raise HTTPException(status_code=500, detail="failed to read project")
        goal_index = _build_goal_index(conn)

    return _project_row_to_out(row, goal_index=goal_index)


@router.put("/projects/{project_id}/goals", response_model=ProjectOut)
def update_project_goals(
    project_id: int, payload: ProjectGoalsIn
) -> ProjectOut:
    """Replace the project's goal links with the provided list.

    Accepts both `user_facts.key` strings (e.g. `"financial_goal"`)
    and `profile:<idx>` identifiers from `/api/goals`. We deduplicate
    and drop blanks but otherwise persist whatever the caller sends —
    the resolver below tolerates orphans so a fact key that later
    gets renamed doesn't 500 every project list fetch.
    """
    # Deduplicate while preserving order so the pills render in the
    # order the user selected them. set() would lose that.
    cleaned: list[str] = []
    seen: set[str] = set()
    for key in payload.goal_keys:
        s = str(key or "").strip()
        if not s or s in seen:
            continue
        cleaned.append(s)
        seen.add(s)

    with get_db() as conn:
        _project_row(conn, project_id)  # raise 404 if missing
        execute(
            conn,
            """
            UPDATE projects
               SET goal_keys = ?,
                   updated_at = datetime('now')
             WHERE id = ?
            """,
            (json.dumps(cleaned, ensure_ascii=False), project_id),
        )
        row = fetch_one(
            conn,
            """
            SELECT
              p.id, p.name, p.description, p.status, p.priority,
              p.started_at, p.goal_keys, p.created_at, p.updated_at,
              COALESCE(s.total_sessions_minutes, 0) AS total_sessions_minutes
            FROM projects p
            LEFT JOIN (
              SELECT project_id, SUM(duration_minutes) AS total_sessions_minutes
              FROM project_logs
              WHERE log_type = 'session'
              GROUP BY project_id
            ) s ON s.project_id = p.id
            WHERE p.id = ?
            """,
            (project_id,),
        )
        if row is None:
            raise HTTPException(status_code=500, detail="failed to read project")
        goal_index = _build_goal_index(conn)

    logger.info(
        "projects: updated goal_keys for project_id=%d → %s",
        project_id,
        cleaned,
    )
    return _project_row_to_out(row, goal_index=goal_index)


@router.post("/projects/{project_id}/logs", response_model=ProjectLogOut)
def add_project_log(project_id: int, body: ProjectLogIn) -> ProjectLogOut:
    note = body.note.strip()
    if not note:
        raise HTTPException(status_code=400, detail="note is required")
    log_type = (body.log_type or "update").strip() or "update"

    with get_db() as conn:
        _project_row(conn, project_id)
        log_id = execute(
            conn,
            """
            INSERT INTO project_logs (project_id, note, log_type, source, created_at)
            VALUES (?, ?, ?, 'manual', datetime('now'))
            """,
            (project_id, note, log_type),
        )
        _touch_project(conn, project_id)
        row = fetch_one(
            conn,
            "SELECT id, note, log_type, duration_minutes, source, created_at FROM project_logs WHERE id = ?",
            (log_id,),
        )

    assert row is not None
    return ProjectLogOut(**row)


@router.post(
    "/projects/{project_id}/sessions/start", response_model=SessionStartOut
)
def start_session(project_id: int) -> SessionStartOut:
    with get_db() as conn:
        _project_row(conn, project_id)
        logs = _logs_for_project(conn, project_id)
        if _detect_active_session(logs) is not None:
            raise HTTPException(
                status_code=409,
                detail="Session already in progress for this project",
            )
        started_at = _utc_now_iso()
        log_id = execute(
            conn,
            """
            INSERT INTO project_logs (project_id, note, log_type, source, created_at)
            VALUES (?, ?, ?, 'manual', ?)
            """,
            (project_id, "Session started", SESSION_START, started_at),
        )
        _touch_project(conn, project_id)

    return SessionStartOut(started_at=started_at, log_id=log_id)


@router.post(
    "/projects/{project_id}/sessions/stop", response_model=ProjectLogOut
)
def stop_session(project_id: int, body: SessionStopIn) -> ProjectLogOut:
    label = body.label.strip()
    if not label:
        raise HTTPException(status_code=400, detail="label is required")

    with get_db() as conn:
        _project_row(conn, project_id)
        logs = _logs_for_project(conn, project_id)
        active = _detect_active_session(logs)
        if active is None:
            raise HTTPException(
                status_code=409,
                detail="No active session for this project",
            )

        started = _parse_iso(active.get("created_at"))
        if started is None:
            raise HTTPException(
                status_code=500,
                detail="Active session has invalid created_at",
            )
        elapsed_seconds = max(
            0, (datetime.now(timezone.utc) - started).total_seconds()
        )
        duration_minutes = max(1, round(elapsed_seconds / 60))
        note = f"{label} · {duration_minutes} min"

        log_id = execute(
            conn,
            """
            INSERT INTO project_logs
              (project_id, note, log_type, duration_minutes, source, created_at)
            VALUES (?, ?, ?, ?, 'manual', datetime('now'))
            """,
            (project_id, note, SESSION, duration_minutes),
        )
        _touch_project(conn, project_id)
        row = fetch_one(
            conn,
            "SELECT id, note, log_type, duration_minutes, source, created_at FROM project_logs WHERE id = ?",
            (log_id,),
        )

    assert row is not None
    return ProjectLogOut(**row)


@router.get(
    "/projects/{project_id}/todos", response_model=ProjectTodosListOut
)
def list_todos(project_id: int) -> ProjectTodosListOut:
    with get_db() as conn:
        _project_row(conn, project_id)
        rows = fetch_all(
            conn,
            """
            SELECT id, project_id, text, done, done_at, created_at
            FROM project_todos
            WHERE project_id = ?
            ORDER BY done ASC, datetime(created_at) DESC, id DESC
            """,
            (project_id,),
        )
    return ProjectTodosListOut(
        todos=[
            ProjectTodoOut(
                id=int(r["id"]),
                project_id=int(r["project_id"]),
                text=str(r["text"]),
                done=bool(r["done"]),
                done_at=r.get("done_at"),
                created_at=r.get("created_at"),
            )
            for r in rows
        ]
    )


@router.post(
    "/projects/{project_id}/todos", response_model=ProjectTodoOut
)
def add_todo(project_id: int, body: ProjectTodoIn) -> ProjectTodoOut:
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    with get_db() as conn:
        _project_row(conn, project_id)
        todo_id = execute(
            conn,
            """
            INSERT INTO project_todos (project_id, text, done, created_at)
            VALUES (?, ?, 0, datetime('now'))
            """,
            (project_id, text),
        )
        row = fetch_one(
            conn,
            "SELECT id, project_id, text, done, done_at, created_at FROM project_todos WHERE id = ?",
            (todo_id,),
        )

    assert row is not None
    return ProjectTodoOut(
        id=int(row["id"]),
        project_id=int(row["project_id"]),
        text=str(row["text"]),
        done=bool(row["done"]),
        done_at=row.get("done_at"),
        created_at=row.get("created_at"),
    )


@router.put("/projects/todos/{todo_id}", response_model=ProjectTodoOut)
def toggle_todo(todo_id: int) -> ProjectTodoOut:
    with get_db() as conn:
        row = fetch_one(
            conn,
            "SELECT id, project_id, text, done, done_at, created_at FROM project_todos WHERE id = ?",
            (todo_id,),
        )
        if row is None:
            raise HTTPException(status_code=404, detail="Todo not found")

        new_done = 0 if bool(row["done"]) else 1
        execute(
            conn,
            """
            UPDATE project_todos
               SET done = ?, done_at = CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END
             WHERE id = ?
            """,
            (new_done, new_done, todo_id),
        )
        row = fetch_one(
            conn,
            "SELECT id, project_id, text, done, done_at, created_at FROM project_todos WHERE id = ?",
            (todo_id,),
        )

    assert row is not None
    return ProjectTodoOut(
        id=int(row["id"]),
        project_id=int(row["project_id"]),
        text=str(row["text"]),
        done=bool(row["done"]),
        done_at=row.get("done_at"),
        created_at=row.get("created_at"),
    )
