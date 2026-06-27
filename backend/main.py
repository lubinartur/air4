from __future__ import annotations

import asyncio
import logging
import os
import sys

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Configure logging BEFORE any app loggers are touched.
# Uvicorn installs handlers for the `uvicorn.*` namespace only; everything
# else (e.g. `chat`, `fact_extractor`, `services.obligation_from_chat`)
# bubbles up to the root logger, which has no handler by default → all
# `logger.info` calls are silently dropped. Default level is controlled
# by the AIR4_LOG_LEVEL env var so production can dial it back to WARNING.
logging.basicConfig(
    level=os.environ.get("AIR4_LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    force=True,
)

from database import DB_PATH, get_db, init_db
from routers import (
    category_rules,
    chat,
    cross_sphere,
    dilemmas,
    events,
    feed,
    finance_recurring,
    followups,
    goals,
    health,
    hypotheses,
    identity,
    insights,
    interview,
    observations,
    observer,
    profile,
    projects,
    recommendation,
    spaces,
    summary,
    transactions,
    upload,
)
from services.cross_sphere_analyzer import run_cross_sphere_analysis
from services.observation_engine import generate_observations
from services.observer import is_observer_enabled, start_observer_thread, stop_observer

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
app.include_router(category_rules.router, prefix="/api", tags=["finance"])
app.include_router(projects.router, prefix="/api", tags=["projects"])
app.include_router(spaces.router, prefix="/api", tags=["spaces"])
app.include_router(dilemmas.router, prefix="/api", tags=["dilemmas"])
app.include_router(observations.router, prefix="/api", tags=["observations"])
app.include_router(observer.router, prefix="/api", tags=["observer"])
app.include_router(cross_sphere.router, prefix="/api", tags=["cross-sphere"])
app.include_router(chat.router, prefix="/api", tags=["chat"])
app.include_router(health.router, prefix="/api", tags=["health"])
app.include_router(profile.router, prefix="/api", tags=["profile"])
app.include_router(events.router, prefix="/api", tags=["events"])
app.include_router(goals.router, prefix="/api", tags=["goals"])
app.include_router(finance_recurring.router, prefix="/api", tags=["finance"])
app.include_router(hypotheses.router, prefix="/api", tags=["hypotheses"])
app.include_router(identity.router, prefix="/api", tags=["identity"])
app.include_router(interview.router, prefix="/api", tags=["interview"])
app.include_router(feed.router, prefix="/api", tags=["feed"])
app.include_router(followups.router, prefix="/api", tags=["followups"])
app.include_router(recommendation.router, prefix="/api/air4", tags=["recommendation"])


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
                    # Cross-sphere runs in the same DB transaction
                    # window so a single 24h tick refreshes both the
                    # LLM observations and the rule-derived
                    # correlations the Patterns card displays.
                    cs_report = run_cross_sphere_analysis(conn)
                _scheduler_logger.info(
                    "observation scheduler: generated %d observation(s); "
                    "cross-sphere saved=%d candidates=%d retired=%d",
                    len(saved),
                    cs_report.get("saved", 0),
                    cs_report.get("candidates", 0),
                    cs_report.get("retired", 0),
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
    # One-time backfill: copy legacy `user_facts`-derived subscriptions
    # into the `subscriptions` table. The migration scans every fact row,
    # so we gate it on an `_app_meta` flag — after the first successful
    # run it never touches `user_facts` again. To re-run after schema
    # changes, delete the row: DELETE FROM _app_meta WHERE key =
    # 'subscription_backfill_done'.
    try:
        from database import get_meta, set_meta
        from services.subscription_migration import (
            migrate_facts_to_subscriptions,
        )

        _MIGRATION_KEY = "subscription_backfill_done"
        with get_db() as conn:
            already_ran = get_meta(conn, _MIGRATION_KEY) == "1"
            if not already_ran:
                report = migrate_facts_to_subscriptions(conn)
                set_meta(conn, _MIGRATION_KEY, "1")
                if report.get("inserted"):
                    logging.getLogger("startup").info(
                        "Backfilled subscriptions from user_facts: %s", report
                    )
                else:
                    logging.getLogger("startup").info(
                        "Subscription backfill ran (no new rows); flag set"
                    )
    except Exception:
        logging.getLogger("startup").exception(
            "Subscription backfill from user_facts failed"
        )
    global _observation_task
    if _observation_task is None or _observation_task.done():
        _observation_task = asyncio.create_task(_run_observation_scheduler())

    if sys.platform == "darwin" and is_observer_enabled(str(DB_PATH)):
        db_path = str(DB_PATH.resolve())
        print(f"👁 Observer db path: {db_path}")
        start_observer_thread(db_path)


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
    stop_observer()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    # Bind to 0.0.0.0 so the server accepts connections from other
    # devices on the network (e.g. phone over Tailscale), not just
    # localhost. Port is configurable via AIR4_PORT, defaulting to 8000.
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.environ.get("AIR4_PORT", "8000")),
        reload=True,
    )
