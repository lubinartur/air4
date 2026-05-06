from __future__ import annotations

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException

from app.database import execute, fetch_all, fetch_one, get_db
from app.models.project import (
    ProjectIn,
    ProjectLogIn,
    ProjectLogOut,
    ProjectOut,
    ProjectWithLogsOut,
)

router = APIRouter()


@router.get("/projects", response_model=list[ProjectOut])
async def list_projects(
    db: aiosqlite.Connection = Depends(get_db),
) -> list[ProjectOut]:
    rows = await fetch_all(
        db,
        """
        SELECT *
        FROM projects
        ORDER BY
          CASE status
            WHEN 'active' THEN 0
            WHEN 'paused' THEN 1
            WHEN 'completed' THEN 2
            WHEN 'archived' THEN 3
            ELSE 99
          END,
          datetime(updated_at) DESC,
          id DESC
        """,
    )
    return [ProjectOut(**r) for r in rows]


@router.post("/projects", response_model=ProjectOut)
async def create_project(
    body: ProjectIn,
    db: aiosqlite.Connection = Depends(get_db),
) -> ProjectOut:
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Project name is required")

    pid = await execute(
        db,
        """
        INSERT INTO projects (name, description, status, started_at)
        VALUES (?, ?, ?, ?)
        """,
        (name, body.description, body.status, body.started_at),
    )
    row = await fetch_one(db, "SELECT * FROM projects WHERE id = ?", (int(pid),))
    if row is None:
        raise HTTPException(status_code=500, detail="Failed to read created project")
    return ProjectOut(**row)


@router.get("/projects/{project_id}", response_model=ProjectWithLogsOut)
async def get_project(
    project_id: int,
    db: aiosqlite.Connection = Depends(get_db),
) -> ProjectWithLogsOut:
    row = await fetch_one(db, "SELECT * FROM projects WHERE id = ?", (int(project_id),))
    if row is None:
        raise HTTPException(status_code=404, detail="Project not found")
    logs = await fetch_all(
        db,
        """
        SELECT *
        FROM project_logs
        WHERE project_id = ?
        ORDER BY datetime(created_at) DESC, id DESC
        """,
        (int(project_id),),
    )
    proj = ProjectWithLogsOut(**row, logs=[ProjectLogOut(**l) for l in logs])
    return proj


@router.put("/projects/{project_id}", response_model=ProjectOut)
async def update_project(
    project_id: int,
    body: ProjectIn,
    db: aiosqlite.Connection = Depends(get_db),
) -> ProjectOut:
    existing = await fetch_one(db, "SELECT * FROM projects WHERE id = ?", (int(project_id),))
    if existing is None:
        raise HTTPException(status_code=404, detail="Project not found")

    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Project name is required")

    await execute(
        db,
        """
        UPDATE projects
        SET name = ?,
            description = ?,
            status = ?,
            started_at = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (name, body.description, body.status, body.started_at, int(project_id)),
    )
    row = await fetch_one(db, "SELECT * FROM projects WHERE id = ?", (int(project_id),))
    if row is None:
        raise HTTPException(status_code=500, detail="Failed to read updated project")
    return ProjectOut(**row)


@router.delete("/projects/{project_id}")
async def delete_project(
    project_id: int,
    db: aiosqlite.Connection = Depends(get_db),
) -> dict[str, bool]:
    row = await fetch_one(db, "SELECT id FROM projects WHERE id = ?", (int(project_id),))
    if row is None:
        raise HTTPException(status_code=404, detail="Project not found")
    await execute(db, "DELETE FROM project_logs WHERE project_id = ?", (int(project_id),))
    await execute(db, "DELETE FROM projects WHERE id = ?", (int(project_id),))
    return {"ok": True}


@router.post("/projects/{project_id}/logs", response_model=ProjectLogOut)
async def add_project_log(
    project_id: int,
    body: ProjectLogIn,
    db: aiosqlite.Connection = Depends(get_db),
) -> ProjectLogOut:
    row = await fetch_one(db, "SELECT id FROM projects WHERE id = ?", (int(project_id),))
    if row is None:
        raise HTTPException(status_code=404, detail="Project not found")
    lid = await execute(
        db,
        "INSERT INTO project_logs (project_id, note, source) VALUES (?, ?, 'manual')",
        (int(project_id), body.note.strip()),
    )
    await execute(
        db,
        "UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        (int(project_id),),
    )
    log_row = await fetch_one(db, "SELECT * FROM project_logs WHERE id = ?", (int(lid),))
    if log_row is None:
        raise HTTPException(status_code=500, detail="Failed to read created log")
    return ProjectLogOut(**log_row)


@router.delete("/projects/{project_id}/logs/{log_id}")
async def delete_project_log(
    project_id: int,
    log_id: int,
    db: aiosqlite.Connection = Depends(get_db),
) -> dict[str, bool]:
    row = await fetch_one(
        db,
        "SELECT id FROM project_logs WHERE id = ? AND project_id = ?",
        (int(log_id), int(project_id)),
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Log not found")
    await execute(db, "DELETE FROM project_logs WHERE id = ?", (int(log_id),))
    await execute(
        db,
        "UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        (int(project_id),),
    )
    return {"ok": True}

