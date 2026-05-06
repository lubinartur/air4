from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

ProjectStatus = Literal["active", "paused", "completed", "archived"]


class ProjectIn(BaseModel):
    name: str = Field(..., min_length=1)
    description: str | None = None
    status: ProjectStatus = "active"
    started_at: str | None = None


class ProjectOut(BaseModel):
    id: int
    name: str
    description: str | None = None
    status: ProjectStatus = "active"
    started_at: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class ProjectLogIn(BaseModel):
    note: str = Field(..., min_length=1)


class ProjectLogOut(BaseModel):
    id: int
    project_id: int
    note: str
    source: str
    created_at: str | None = None


class ProjectWithLogsOut(ProjectOut):
    logs: list[ProjectLogOut] = Field(default_factory=list)

