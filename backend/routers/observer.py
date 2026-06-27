from __future__ import annotations

import sys
from collections import defaultdict
from datetime import date
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from database import fetch_all, fetch_one, get_db
from services.observer import (
    is_observer_enabled,
    is_observer_running,
    start_observer_thread,
    stop_observer,
)

router = APIRouter()

_PROFILE_ID = 1


class ObserverToggleIn(BaseModel):
    enabled: bool


def _row_to_event(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "app_name": row["app_name"],
        "window_title": row.get("window_title"),
        "duration_seconds": row["duration_seconds"],
        "domain": row.get("domain"),
        "project_hint": row.get("project_hint"),
        "observed_at": row.get("observed_at"),
    }


@router.get("/observer/status")
def observer_status() -> dict[str, bool]:
    with get_db() as conn:
        row = fetch_one(
            conn,
            "SELECT observer_enabled FROM user_profile WHERE id = ?",
            (_PROFILE_ID,),
        )
    enabled = bool(row.get("observer_enabled")) if row else True
    running = enabled and is_observer_running()
    if sys.platform != "darwin":
        running = False
    return {"enabled": enabled, "running": running}


@router.put("/observer/toggle")
def observer_toggle(body: ObserverToggleIn) -> dict[str, bool]:
    with get_db() as conn:
        conn.execute(
            "UPDATE user_profile SET observer_enabled = ?, updated_at = datetime('now') WHERE id = ?",
            (1 if body.enabled else 0, _PROFILE_ID),
        )

    if body.enabled:
        if sys.platform == "darwin":
            start_observer_thread()
    else:
        stop_observer()

    return observer_status()


@router.get("/observer/today")
def observer_today() -> dict[str, Any]:
    today_str = date.today().isoformat()
    with get_db() as conn:
        rows = fetch_all(
            conn,
            """
            SELECT id, app_name, window_title, duration_seconds, domain,
                   project_hint, observed_at
            FROM observer_events
            WHERE date(observed_at) = ?
            ORDER BY observed_at DESC
            """,
            (today_str,),
        )

    events = [_row_to_event(r) for r in rows]
    total_seconds = sum(int(e["duration_seconds"]) for e in events)

    by_domain: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"minutes": 0, "events": []}
    )
    for event in events:
        domain = event.get("domain") or "other"
        by_domain[domain]["minutes"] += int(event["duration_seconds"]) // 60
        by_domain[domain]["events"].append(event)

    app_agg: dict[str, dict[str, Any]] = {}
    for event in events:
        app = event["app_name"]
        if app not in app_agg:
            app_agg[app] = {
                "app": app,
                "window": event.get("window_title") or "",
                "seconds": 0,
                "project_hint": event.get("project_hint") or "",
            }
        app_agg[app]["seconds"] += int(event["duration_seconds"])
        hint = event.get("project_hint") or ""
        if hint and not app_agg[app]["project_hint"]:
            app_agg[app]["project_hint"] = hint
        window = event.get("window_title") or ""
        if window and not app_agg[app]["window"]:
            app_agg[app]["window"] = window

    by_app = [
        {
            "app": item["app"],
            "window": item["window"],
            "minutes": item["seconds"] // 60,
            "project_hint": item["project_hint"],
        }
        for item in sorted(app_agg.values(), key=lambda x: -x["seconds"])
    ]

    return {
        "date": today_str,
        "total_minutes": total_seconds // 60,
        "by_domain": dict(by_domain),
        "by_app": by_app,
        "recent": events[:10],
    }


@router.get("/observer/log")
def observer_log(days: int = 7, limit: int = 50) -> list[dict[str, Any]]:
    days = max(1, min(days, 90))
    limit = max(1, min(limit, 500))
    with get_db() as conn:
        rows = fetch_all(
            conn,
            """
            SELECT id, app_name, window_title, duration_seconds, domain,
                   project_hint, observed_at
            FROM observer_events
            WHERE date(observed_at) >= date('now', ? || ' days', 'localtime')
            ORDER BY datetime(observed_at) DESC, id DESC
            LIMIT ?
            """,
            (f"-{days - 1}", limit),
        )
    return [_row_to_event(r) for r in rows]
