from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class UploadPeriodSummaryOut(BaseModel):
    upload_id: int
    period_start: str | None
    period_end: str | None
    total_spent: float
    by_category: list[dict[str, Any]]
    transaction_count: int


class TimelineOut(BaseModel):
    uploads: list[UploadPeriodSummaryOut]


class CompareDiffRowOut(BaseModel):
    category: str
    period1_amount: float
    period2_amount: float
    diff: float
    diff_pct: float


class CompareDiffOut(BaseModel):
    total: float
    total_pct: float
    by_category: list[CompareDiffRowOut]


class CompareOut(BaseModel):
    period1: UploadPeriodSummaryOut
    period2: UploadPeriodSummaryOut
    diff: CompareDiffOut

