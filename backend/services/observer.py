from __future__ import annotations

import re
import sqlite3
import subprocess
import sys
import threading
import time
from datetime import datetime

from database import DB_PATH

TRACKED_APPS = {
    "Cursor": "projects",
    "Code": "projects",
    "Figma": "projects",
    "Sketch": "projects",
    "Terminal": "projects",
    "Xcode": "projects",
    "Chrome": "browser",
    "Safari": "browser",
    "Firefox": "browser",
    "Telegram": "communication",
    "Slack": "communication",
    "Mail": "communication",
    "WhatsApp": "communication",
    "Notes": "life",
    "Notion": "projects",
    "Bear": "life",
    "Obsidian": "life",
}

MIN_DURATION = 60  # 1 minute (raise after confirming observer works)

_observer_running = False
_observer_thread: threading.Thread | None = None
_observer_lock = threading.Lock()


def get_active_app() -> dict[str, str]:
    if sys.platform != "darwin":
        return {"app": "", "window": ""}
    script = """
    tell application "System Events"
        set frontApp to name of first application process whose frontmost is true
        set frontWindow to ""
        try
            set frontWindow to name of front window of process frontApp
        end try
        return frontApp & "|" & frontWindow
    end tell
    """
    result = subprocess.run(
        ["osascript", "-e", script],
        capture_output=True,
        text=True,
    )
    if result.returncode == 0:
        parts = result.stdout.strip().split("|")
        return {
            "app": parts[0].strip(),
            "window": parts[1].strip() if len(parts) > 1 else "",
        }
    return {"app": "", "window": ""}


def extract_project_hint(app: str, window: str) -> str:
    """Try to extract project name from window title."""
    del app  # reserved for app-specific rules later
    if not window:
        return ""
    patterns = [
        r"—\s*(.+?)(?:\s*[-–]|$)",
        r"•\s*(.+?)(?:\s*[-–]|$)",
    ]
    for pattern in patterns:
        match = re.search(pattern, window)
        if match:
            return match.group(1).strip()[:50]
    return window[:50]


def is_observer_enabled(db_path: str | None = None) -> bool:
    path = db_path or str(DB_PATH)
    try:
        conn = sqlite3.connect(path)
        row = conn.execute(
            "SELECT observer_enabled FROM user_profile WHERE id = 1"
        ).fetchone()
        conn.close()
        return bool(row[0]) if row else True
    except Exception:
        return True


def save_event(
    db_path: str,
    app: str,
    window: str,
    duration: int,
    domain: str,
) -> None:
    print(f"👁 Saving: {app} | {window} | {duration}s | {domain}")
    project_hint = extract_project_hint(app, window)
    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        INSERT INTO observer_events
        (app_name, window_title, duration_seconds, domain,
         project_hint, observed_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            app,
            window,
            duration,
            domain,
            project_hint,
            datetime.now().isoformat(),
        ),
    )
    conn.commit()
    conn.close()


def run_observer(db_path: str | None = None) -> None:
    global _observer_running
    path = db_path or str(DB_PATH)
    _observer_running = True

    current_app: str | None = None
    current_window: str | None = None
    session_start: float | None = None
    check_interval = 10

    print("👁 Observer started")

    while _observer_running:
        try:
            if not is_observer_enabled(path):
                time.sleep(30)
                continue

            active = get_active_app()
            app = active["app"]
            window = active["window"]

            if app != current_app or window != current_window:
                print(f"👁 Switch detected: {current_app} → {app}")
                if current_app and session_start:
                    duration = int(time.time() - session_start)
                    if duration >= MIN_DURATION:
                        domain = TRACKED_APPS.get(current_app, "other")
                        if domain != "other":
                            save_event(
                                path,
                                current_app,
                                current_window or "",
                                duration,
                                domain,
                            )
                            print(f"👁 {current_app} — {duration // 60}мин")

                current_app = app
                current_window = window
                session_start = time.time()

        except Exception as e:
            print(f"Observer error: {e}")

        time.sleep(check_interval)

    print("👁 Observer stopped")


def stop_observer() -> None:
    global _observer_running
    _observer_running = False


def is_observer_running() -> bool:
    if sys.platform != "darwin":
        return False
    return (
        _observer_running
        and _observer_thread is not None
        and _observer_thread.is_alive()
    )


def start_observer_thread(db_path: str | None = None) -> bool:
    """Start the background observer loop if not already running."""
    if sys.platform != "darwin":
        return False
    path = db_path or str(DB_PATH)
    global _observer_thread
    with _observer_lock:
        if _observer_thread is not None and _observer_thread.is_alive():
            return False
        _observer_thread = threading.Thread(
            target=run_observer,
            args=(path,),
            daemon=True,
            name="air4-observer",
        )
        _observer_thread.start()
        return True
