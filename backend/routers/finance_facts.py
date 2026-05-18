from __future__ import annotations

from fastapi import APIRouter

from database import fetch_all, get_db
from schemas import ObligationsListOut, SubscriptionsListOut
from services.finance_facts import filter_obligation_rows, filter_subscription_rows

router = APIRouter()


@router.get("/finance/subscriptions", response_model=SubscriptionsListOut)
def list_subscriptions() -> SubscriptionsListOut:
    with get_db() as conn:
        rows = fetch_all(
            conn,
            """
            SELECT key, value
            FROM user_facts
            ORDER BY confidence DESC, datetime(updated_at) DESC, id DESC
            """,
        )
    return SubscriptionsListOut(subscriptions=filter_subscription_rows(rows))


@router.get("/finance/obligations", response_model=ObligationsListOut)
def list_obligations() -> ObligationsListOut:
    with get_db() as conn:
        rows = fetch_all(
            conn,
            """
            SELECT key, value
            FROM user_facts
            ORDER BY confidence DESC, datetime(updated_at) DESC, id DESC
            """,
        )
    return ObligationsListOut(obligations=filter_obligation_rows(rows))
