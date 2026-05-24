"""Public API for cross-sphere insights.

A single read endpoint right now. Generation happens elsewhere — the
analyzer runs from the observation scheduler (every 24h) and from
`POST /api/observations/generate` so this router stays cache-friendly
and read-only.
"""

from __future__ import annotations

from fastapi import APIRouter

from database import get_db
from schemas import CrossSphereInsightOut, CrossSphereInsightsOut
from services.cross_sphere_analyzer import fetch_active_insights

router = APIRouter()


@router.get("/cross-sphere", response_model=CrossSphereInsightsOut)
def list_cross_sphere_insights(limit: int = 20) -> CrossSphereInsightsOut:
    """Active = ``is_active=1`` AND ``expires_at > now``.

    Sorted by confidence DESC then recency DESC inside the service
    layer so callers can slice the prefix without re-sorting.
    """
    # Hard cap protects against a malicious caller blowing the page
    # size; the analyzer rarely produces more than a handful per day.
    safe_limit = max(1, min(limit, 50))
    with get_db() as conn:
        rows = fetch_active_insights(conn, limit=safe_limit)
    return CrossSphereInsightsOut(
        insights=[CrossSphereInsightOut(**row) for row in rows]
    )
