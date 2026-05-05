from __future__ import annotations

from pydantic import BaseModel


class ReportOut(BaseModel):
    report: str
