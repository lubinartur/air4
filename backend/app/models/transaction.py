from __future__ import annotations

from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.models.event import EventOut
from app.models.fact import UserFactOut


Category = Literal[
    "food_groceries",
    "food_restaurants",
    "transport",
    "entertainment",
    "health",
    "subscriptions",
    "shopping",
    "transfers",
    "utilities",
    "other",
]


class TransactionIn(BaseModel):
    date: date
    description: str
    raw_description: str
    amount: float = Field(ge=0)
    currency: str = "EUR"
    is_debit: bool
    account_iban: str
    is_internal_transfer: bool = False


class TransactionOut(BaseModel):
    id: int
    upload_id: int
    date: str
    description: str
    amount: float
    currency: str
    category: str
    category_confirmed: bool
    account_iban: str | None
    is_debit: bool
    is_internal_transfer: bool
    raw_description: str | None
    created_at: str | None


class UpdateCategoryIn(BaseModel):
    category: Category


class UploadSummaryOut(BaseModel):
    upload_id: int
    filename: str | None
    account_ibans: list[str]
    period_start: str | None
    period_end: str | None
    total_transactions: int
    categories: dict[str, int]


class PaginatedTransactionsOut(BaseModel):
    total: int
    skip: int
    limit: int
    items: list[TransactionOut]


class SummaryOut(BaseModel):
    upload_id: int | None
    total_spent: float
    by_category: list[dict[str, Any]]
    period_start: str | None = None
    period_end: str | None = None
    created_at: str | None = None


class InsightOut(BaseModel):
    type: str
    title: str
    description: str
    amount_mentioned: float | None = None


class ChatIn(BaseModel):
    message: str
    history: list[dict[str, Any]] = Field(default_factory=list)
    current_page: str | None = Field(
        None, description="UI route context: upload, dashboard, events, chat, other"
    )


class ChatOut(BaseModel):
    response: str
    """Populated when the chat message contained a memorable event and it was saved."""
    event_saved: EventOut | None = None
    """Facts extracted from this user message and upserted into storage."""
    facts_saved: list[UserFactOut] = Field(default_factory=list)
