"""Subscriptions & obligations (recurring fixed costs) management.

Replaces the legacy `finance_facts` router which derived these lists from
`user_facts`. Data now lives in dedicated `subscriptions` and `obligations`
tables and can be edited via standard CRUD endpoints.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from database import execute, fetch_all, fetch_one, get_db
from schemas import (
    DeleteResultOut,
    MonthlyFixedOut,
    ObligationIn,
    ObligationOut,
    ObligationUpdateIn,
    ObligationsListOut,
    SubscriptionIn,
    SubscriptionOut,
    SubscriptionUpdateIn,
    SubscriptionsListOut,
)

router = APIRouter()


def _row_to_subscription(row: dict[str, Any]) -> SubscriptionOut:
    return SubscriptionOut(
        id=int(row["id"]),
        name=str(row.get("name") or ""),
        amount=row.get("amount"),
        currency=str(row.get("currency") or "EUR"),
        billing_day=row.get("billing_day"),
        category=str(row.get("category") or "other"),
        is_active=bool(row.get("is_active", 1)),
        source=str(row.get("source") or "manual"),
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
    )


def _row_to_obligation(row: dict[str, Any]) -> ObligationOut:
    return ObligationOut(
        id=int(row["id"]),
        name=str(row.get("name") or ""),
        total_amount=row.get("total_amount"),
        remaining_amount=row.get("remaining_amount"),
        monthly_payment=row.get("monthly_payment"),
        interest_rate=row.get("interest_rate"),
        due_date=row.get("due_date"),
        category=str(row.get("category") or "loan"),
        is_active=bool(row.get("is_active", 1)),
        source=str(row.get("source") or "manual"),
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
    )


# ---------------------------------------------------------------------------
# Subscriptions
# ---------------------------------------------------------------------------


@router.get("/finance/subscriptions", response_model=SubscriptionsListOut)
def list_subscriptions() -> SubscriptionsListOut:
    with get_db() as conn:
        rows = fetch_all(
            conn,
            """
            SELECT id, name, amount, currency, billing_day, category,
                   is_active, source, created_at, updated_at
            FROM subscriptions
            WHERE is_active = 1
            ORDER BY datetime(updated_at) DESC, id DESC
            """,
        )
    return SubscriptionsListOut(
        subscriptions=[_row_to_subscription(r) for r in rows]
    )


@router.post("/finance/subscriptions", response_model=SubscriptionOut)
def create_subscription(payload: SubscriptionIn) -> SubscriptionOut:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required.")
    with get_db() as conn:
        new_id = execute(
            conn,
            """
            INSERT INTO subscriptions
                (name, amount, currency, billing_day, category, is_active,
                 source, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 1, 'manual', datetime('now'), datetime('now'))
            """,
            (
                name,
                payload.amount,
                payload.currency or "EUR",
                payload.billing_day,
                payload.category or "other",
            ),
        )
        row = fetch_one(
            conn,
            "SELECT * FROM subscriptions WHERE id = ?",
            (new_id,),
        )
    if row is None:
        raise HTTPException(status_code=500, detail="Failed to load created subscription.")
    return _row_to_subscription(row)


@router.put("/finance/subscriptions/{subscription_id}", response_model=SubscriptionOut)
def update_subscription(
    subscription_id: int, payload: SubscriptionUpdateIn
) -> SubscriptionOut:
    fields = payload.model_dump(exclude_unset=True)
    if not fields:
        with get_db() as conn:
            row = fetch_one(
                conn,
                "SELECT * FROM subscriptions WHERE id = ?",
                (subscription_id,),
            )
        if row is None:
            raise HTTPException(status_code=404, detail="Subscription not found.")
        return _row_to_subscription(row)

    set_parts: list[str] = []
    values: list[Any] = []
    for key, value in fields.items():
        if key == "is_active":
            value = 1 if value else 0
        set_parts.append(f"{key} = ?")
        values.append(value)
    set_parts.append("updated_at = datetime('now')")
    values.append(subscription_id)

    with get_db() as conn:
        existing = fetch_one(
            conn,
            "SELECT id FROM subscriptions WHERE id = ?",
            (subscription_id,),
        )
        if existing is None:
            raise HTTPException(status_code=404, detail="Subscription not found.")
        execute(
            conn,
            f"UPDATE subscriptions SET {', '.join(set_parts)} WHERE id = ?",
            values,
        )
        row = fetch_one(
            conn,
            "SELECT * FROM subscriptions WHERE id = ?",
            (subscription_id,),
        )
    if row is None:
        raise HTTPException(status_code=500, detail="Failed to load updated subscription.")
    return _row_to_subscription(row)


@router.delete(
    "/finance/subscriptions/{subscription_id}", response_model=DeleteResultOut
)
def delete_subscription(subscription_id: int) -> DeleteResultOut:
    with get_db() as conn:
        existing = fetch_one(
            conn,
            "SELECT id FROM subscriptions WHERE id = ?",
            (subscription_id,),
        )
        if existing is None:
            raise HTTPException(status_code=404, detail="Subscription not found.")
        execute(
            conn,
            """
            UPDATE subscriptions
               SET is_active = 0, updated_at = datetime('now')
             WHERE id = ?
            """,
            (subscription_id,),
        )
    return DeleteResultOut(deleted=True, id=subscription_id)


# ---------------------------------------------------------------------------
# Obligations
# ---------------------------------------------------------------------------


@router.get("/finance/obligations", response_model=ObligationsListOut)
def list_obligations() -> ObligationsListOut:
    with get_db() as conn:
        rows = fetch_all(
            conn,
            """
            SELECT id, name, total_amount, remaining_amount, monthly_payment,
                   interest_rate, due_date, category, is_active, source,
                   created_at, updated_at
            FROM obligations
            WHERE is_active = 1
            ORDER BY datetime(updated_at) DESC, id DESC
            """,
        )
    return ObligationsListOut(
        obligations=[_row_to_obligation(r) for r in rows]
    )


@router.post("/finance/obligations", response_model=ObligationOut)
def create_obligation(payload: ObligationIn) -> ObligationOut:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required.")
    with get_db() as conn:
        new_id = execute(
            conn,
            """
            INSERT INTO obligations
                (name, total_amount, remaining_amount, monthly_payment,
                 interest_rate, due_date, category, is_active, source,
                 created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'manual',
                    datetime('now'), datetime('now'))
            """,
            (
                name,
                payload.total_amount,
                payload.remaining_amount,
                payload.monthly_payment,
                payload.interest_rate,
                payload.due_date,
                payload.category or "loan",
            ),
        )
        row = fetch_one(
            conn,
            "SELECT * FROM obligations WHERE id = ?",
            (new_id,),
        )
    if row is None:
        raise HTTPException(status_code=500, detail="Failed to load created obligation.")
    return _row_to_obligation(row)


@router.put("/finance/obligations/{obligation_id}", response_model=ObligationOut)
def update_obligation(
    obligation_id: int, payload: ObligationUpdateIn
) -> ObligationOut:
    fields = payload.model_dump(exclude_unset=True)
    if not fields:
        with get_db() as conn:
            row = fetch_one(
                conn,
                "SELECT * FROM obligations WHERE id = ?",
                (obligation_id,),
            )
        if row is None:
            raise HTTPException(status_code=404, detail="Obligation not found.")
        return _row_to_obligation(row)

    set_parts: list[str] = []
    values: list[Any] = []
    for key, value in fields.items():
        if key == "is_active":
            value = 1 if value else 0
        set_parts.append(f"{key} = ?")
        values.append(value)
    set_parts.append("updated_at = datetime('now')")
    values.append(obligation_id)

    with get_db() as conn:
        existing = fetch_one(
            conn,
            "SELECT id FROM obligations WHERE id = ?",
            (obligation_id,),
        )
        if existing is None:
            raise HTTPException(status_code=404, detail="Obligation not found.")
        execute(
            conn,
            f"UPDATE obligations SET {', '.join(set_parts)} WHERE id = ?",
            values,
        )
        row = fetch_one(
            conn,
            "SELECT * FROM obligations WHERE id = ?",
            (obligation_id,),
        )
    if row is None:
        raise HTTPException(status_code=500, detail="Failed to load updated obligation.")
    return _row_to_obligation(row)


@router.delete(
    "/finance/obligations/{obligation_id}", response_model=DeleteResultOut
)
def delete_obligation(obligation_id: int) -> DeleteResultOut:
    with get_db() as conn:
        existing = fetch_one(
            conn,
            "SELECT id FROM obligations WHERE id = ?",
            (obligation_id,),
        )
        if existing is None:
            raise HTTPException(status_code=404, detail="Obligation not found.")
        execute(
            conn,
            """
            UPDATE obligations
               SET is_active = 0, updated_at = datetime('now')
             WHERE id = ?
            """,
            (obligation_id,),
        )
    return DeleteResultOut(deleted=True, id=obligation_id)


# ---------------------------------------------------------------------------
# Monthly fixed costs (aggregated)
# ---------------------------------------------------------------------------


@router.get("/finance/monthly-fixed", response_model=MonthlyFixedOut)
def monthly_fixed_costs() -> MonthlyFixedOut:
    with get_db() as conn:
        subs_row = fetch_one(
            conn,
            """
            SELECT
                COALESCE(SUM(amount), 0) AS total,
                COUNT(*) AS cnt
            FROM subscriptions
            WHERE is_active = 1 AND amount IS NOT NULL
            """,
        )
        obs_row = fetch_one(
            conn,
            """
            SELECT
                COALESCE(SUM(monthly_payment), 0) AS total,
                COUNT(*) AS cnt
            FROM obligations
            WHERE is_active = 1 AND monthly_payment IS NOT NULL
            """,
        )

    subs_total = float((subs_row or {}).get("total") or 0)
    obs_total = float((obs_row or {}).get("total") or 0)
    subs_count = int((subs_row or {}).get("cnt") or 0)
    obs_count = int((obs_row or {}).get("cnt") or 0)
    return MonthlyFixedOut(
        subscriptions_total=round(subs_total, 2),
        obligations_total=round(obs_total, 2),
        fixed_total=round(subs_total + obs_total, 2),
        subscriptions_count=subs_count,
        obligations_count=obs_count,
    )
