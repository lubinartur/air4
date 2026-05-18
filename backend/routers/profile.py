from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter

from database import fetch_all, fetch_one, get_db
from schemas import ProfileBundleOut, ProfileStatsOut, UserFactOut, UserProfileSectionOut

router = APIRouter()

_PROFILE_ID = 1


def _parse_goals(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return [str(g).strip() for g in raw if str(g).strip()]
    text = str(raw).strip()
    if not text:
        return []
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return [str(g).strip() for g in parsed if str(g).strip()]
    except json.JSONDecodeError:
        pass
    return [part.strip() for part in text.split(",") if part.strip()]


def _profile_section(row: dict[str, Any] | None) -> UserProfileSectionOut:
    if not row:
        return UserProfileSectionOut()
    income = row.get("monthly_income")
    return UserProfileSectionOut(
        name=row.get("name"),
        city=row.get("city"),
        profession=row.get("profession"),
        monthly_income=float(income) if income is not None else None,
        goals=_parse_goals(row.get("goals")),
        context=row.get("context"),
    )


@router.get("/profile", response_model=ProfileBundleOut)
def get_profile_bundle() -> ProfileBundleOut:
    with get_db() as conn:
        profile_row = fetch_one(conn, "SELECT * FROM user_profile WHERE id = ?", (_PROFILE_ID,))

        fact_rows = fetch_all(
            conn,
            """
            SELECT key, value, confidence, updated_at
            FROM user_facts
            ORDER BY confidence DESC, datetime(updated_at) DESC, id DESC
            """,
        )

        tx_count_row = fetch_one(conn, "SELECT COUNT(*) AS n FROM transactions")
        events_count_row = fetch_one(conn, "SELECT COUNT(*) AS n FROM events")
        facts_count_row = fetch_one(conn, "SELECT COUNT(*) AS n FROM user_facts")

        member_row = fetch_one(
            conn,
            """
            SELECT MIN(entry_date) AS member_since
            FROM (
                SELECT date AS entry_date FROM transactions
                WHERE date IS NOT NULL AND TRIM(date) != ''
                UNION ALL
                SELECT date AS entry_date FROM events
                WHERE date IS NOT NULL AND TRIM(date) != ''
                UNION ALL
                SELECT DATE(created_at) AS entry_date FROM user_profile
                WHERE id = 1 AND created_at IS NOT NULL
            )
            """,
        )

    facts = [
        UserFactOut(
            key=str(r["key"]),
            value=str(r["value"]),
            confidence=float(r.get("confidence") or 1.0),
            updated_at=r.get("updated_at"),
        )
        for r in fact_rows
    ]

    stats = ProfileStatsOut(
        total_transactions=int(tx_count_row["n"]) if tx_count_row else 0,
        total_events=int(events_count_row["n"]) if events_count_row else 0,
        facts_count=int(facts_count_row["n"]) if facts_count_row else 0,
        member_since=member_row.get("member_since") if member_row else None,
    )

    return ProfileBundleOut(
        profile=_profile_section(dict(profile_row) if profile_row else None),
        facts=facts,
        stats=stats,
    )
