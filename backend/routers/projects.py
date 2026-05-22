from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from database import execute, fetch_all, fetch_one, get_db
from schemas import (
    ActiveSessionOut,
    ProjectDetailOut,
    ProjectIn,
    ProjectLogIn,
    ProjectLogOut,
    ProjectOut,
    ProjectTodoIn,
    ProjectTodoOut,
    ProjectTodosListOut,
    SessionStartOut,
    SessionStopIn,
)


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
        SELECT id, name, description, status, priority, started_at, created_at, updated_at
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
            SELECT id, name, description, status, priority, started_at, created_at, updated_at
            FROM projects
            WHERE id = ?
            """,
            (project_id,),
        )

    if row is None:
        raise HTTPException(status_code=500, detail="failed to persist project")
    return ProjectOut(**row)


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
              p.started_at, p.created_at, p.updated_at,
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
    return [ProjectOut(**r) for r in rows]


@router.get("/projects/{project_id}", response_model=ProjectDetailOut)
def get_project(project_id: int) -> ProjectDetailOut:
    with get_db() as conn:
        project = _project_row(conn, project_id)
        logs = _logs_for_project(conn, project_id)
        active = _detect_active_session(logs)
        total_minutes = _total_minutes(conn, project_id)

    return ProjectDetailOut(
        **project,
        logs=[ProjectLogOut(**log) for log in logs],
        total_sessions_minutes=total_minutes,
        active_session=(
            ActiveSessionOut(started_at=str(active["created_at"]))
            if active and active.get("created_at")
            else None
        ),
    )


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
