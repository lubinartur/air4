from __future__ import annotations

import logging
import os

from fastapi import APIRouter

from database import fetch_all, get_db
from schemas import ObservationGenerateOut, ObservationOut
from services.cross_sphere_analyzer import run_cross_sphere_analysis
from services.observation_engine import generate_observations

router = APIRouter()

logger = logging.getLogger("observations")


@router.get("/observations", response_model=list[ObservationOut])
def list_observations() -> list[ObservationOut]:
    with get_db() as conn:
        rows = fetch_all(
            conn,
            """
            SELECT id, title, body, observation_type, is_read, created_at
            FROM observations
            ORDER BY datetime(created_at) DESC, id DESC
            LIMIT 20
            """,
        )
    return [ObservationOut(**r) for r in rows]


@router.post("/observations/generate", response_model=ObservationGenerateOut)
async def generate_observations_endpoint() -> ObservationGenerateOut:
    api_key = os.getenv("ANTHROPIC_API_KEY", "") or ""
    with get_db() as conn:
        saved = await generate_observations(conn, api_key)
        # Cross-sphere is intentionally rule-only (no LLM cost), so
        # we run it on every observation refresh as well as the daily
        # scheduler tick. Failures are non-fatal — observations still
        # return even if the analyzer trips.
        try:
            cs_report = run_cross_sphere_analysis(conn)
            logger.info(
                "cross-sphere from /observations/generate: saved=%d "
                "candidates=%d retired=%d",
                cs_report.get("saved", 0),
                cs_report.get("candidates", 0),
                cs_report.get("retired", 0),
            )
        except Exception:
            logger.exception("cross-sphere analyzer failed during observations/generate")
    observations = [
        ObservationOut(
            id=int(r["id"]),
            title=str(r["title"]),
            body=str(r["body"]),
            observation_type=str(r.get("observation_type") or "pattern"),
            is_read=bool(r.get("is_read")),
            created_at=r.get("created_at"),
        )
        for r in saved
    ]
    return ObservationGenerateOut(
        generated=len(observations),
        observations=observations,
    )
