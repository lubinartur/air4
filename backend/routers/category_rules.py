"""GET /api/category-rules — list of merchant→category rules learned
from user confirmations on the CategoryReview screen.

Rules are seeded by `PUT /api/transactions/{id}/category` (handler in
`routers/transactions.py`) and applied on every CSV upload by
`services.categorizer.apply_category_rules`. This endpoint is purely
read-only — it exists so the UI can surface which merchants have
"sticky" categorizations and how often each rule has fired (great for
debugging and for future "manage rules" UI).

Ordering rationale: most-used rules first (`times_applied DESC`),
then freshest, so the list reads as a leaderboard of categorization
memory.
"""

from __future__ import annotations

from fastapi import APIRouter

from database import fetch_all, get_db
from schemas import CategoryRuleOut, CategoryRulesListOut

router = APIRouter()


def _row_to_category_rule(row: dict) -> CategoryRuleOut:
    """SQLite Row → Pydantic. Coerces nullable numeric fields and
    falls back to safe defaults so a partially-populated row still
    round-trips cleanly through the response model."""
    return CategoryRuleOut(
        id=int(row["id"]),
        pattern=str(row["pattern"]),
        category=str(row["category"]),
        match_type=str(row.get("match_type") or "contains"),
        confidence=float(row.get("confidence") or 1.0),
        times_applied=int(row.get("times_applied") or 0),
        source=str(row.get("source") or "user"),
        created_at=(
            str(row["created_at"]) if row.get("created_at") is not None else None
        ),
        updated_at=(
            str(row["updated_at"]) if row.get("updated_at") is not None else None
        ),
    )


@router.get("/category-rules", response_model=CategoryRulesListOut)
def list_category_rules() -> CategoryRulesListOut:
    with get_db() as conn:
        rows = fetch_all(
            conn,
            """
            SELECT id, pattern, category, match_type, confidence,
                   times_applied, source, created_at, updated_at
              FROM category_rules
             ORDER BY times_applied DESC,
                      datetime(updated_at) DESC,
                      id DESC
            """,
        )
    return CategoryRulesListOut(
        rules=[_row_to_category_rule(r) for r in rows]
    )
