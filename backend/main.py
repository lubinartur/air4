from __future__ import annotations

import asyncio
import logging
import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import get_db, init_db
from routers import (
    chat,
    dilemmas,
    events,
    finance_facts,
    goals,
    health,
    hypotheses,
    insights,
    interview,
    observations,
    profile,
    projects,
    summary,
    transactions,
    upload,
)
from services.observation_engine import generate_observations

load_dotenv()

app = FastAPI(title="AIR4", version="1.0.0")

cors_origins = os.environ.get(
    "AIR4_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
).split(",")
cors_origins = [o.strip() for o in cors_origins if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(upload.router, prefix="/api", tags=["upload"])
app.include_router(summary.router, prefix="/api", tags=["summary"])
app.include_router(insights.router, prefix="/api", tags=["insights"])
app.include_router(transactions.router, prefix="/api", tags=["transactions"])
app.include_router(projects.router, prefix="/api", tags=["projects"])
app.include_router(dilemmas.router, prefix="/api", tags=["dilemmas"])
app.include_router(observations.router, prefix="/api", tags=["observations"])
app.include_router(chat.router, prefix="/api", tags=["chat"])
app.include_router(health.router, prefix="/api", tags=["health"])
app.include_router(profile.router, prefix="/api", tags=["profile"])
app.include_router(events.router, prefix="/api", tags=["events"])
app.include_router(goals.router, prefix="/api", tags=["goals"])
app.include_router(finance_facts.router, prefix="/api", tags=["finance"])
app.include_router(hypotheses.router, prefix="/api", tags=["hypotheses"])
app.include_router(interview.router, prefix="/api", tags=["interview"])


_scheduler_logger = logging.getLogger("observations.scheduler")
_OBSERVATION_INTERVAL_SECONDS = int(
    os.environ.get("AIR4_OBSERVATION_INTERVAL_SECONDS", str(24 * 60 * 60))
)
_OBSERVATION_INITIAL_DELAY_SECONDS = int(
    os.environ.get("AIR4_OBSERVATION_INITIAL_DELAY_SECONDS", "10")
)

_observation_task: asyncio.Task | None = None


async def _run_observation_scheduler() -> None:
    """Background loop: generate observations once at startup, then every 24h."""
    try:
        await asyncio.sleep(_OBSERVATION_INITIAL_DELAY_SECONDS)
        while True:
            try:
                api_key = os.getenv("ANTHROPIC_API_KEY", "") or ""
                with get_db() as conn:
                    saved = await generate_observations(conn, api_key)
                _scheduler_logger.info(
                    "observation scheduler: generated %d observation(s)",
                    len(saved),
                )
            except asyncio.CancelledError:
                raise
            except Exception:
                _scheduler_logger.exception("observation scheduler tick failed")
            await asyncio.sleep(_OBSERVATION_INTERVAL_SECONDS)
    except asyncio.CancelledError:
        _scheduler_logger.info("observation scheduler cancelled")
        raise


@app.on_event("startup")
async def startup() -> None:
    init_db()
    global _observation_task
    if _observation_task is None or _observation_task.done():
        _observation_task = asyncio.create_task(_run_observation_scheduler())


@app.on_event("shutdown")
async def shutdown() -> None:
    global _observation_task
    if _observation_task is not None and not _observation_task.done():
        _observation_task.cancel()
        try:
            await _observation_task
        except (asyncio.CancelledError, Exception):
            pass
        _observation_task = None


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
