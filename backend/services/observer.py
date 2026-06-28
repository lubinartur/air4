from __future__ import annotations

import re
import sqlite3
import subprocess
import sys
import threading
import time
from datetime import datetime

from database import DB_PATH
from services.test_mode import is_test_mode

TRACKED_APPS = {
    "Cursor": "projects",
    "Code": "projects",
    "Figma": "projects",
    "Sketch": "projects",
    "Terminal": "projects",
    "Xcode": "projects",
    "Chrome": "browser",
    "Google Chrome": "browser",
    "Safari": "browser",
    "Firefox": "browser",
    "Arc": "browser",
    "Telegram": "communication",
    "Slack": "communication",
    "Mail": "communication",
    "WhatsApp": "communication",
    "Notes": "life",
    "Notion": "projects",
    "Bear": "life",
    "Obsidian": "life",
}

MIN_DURATION = 60  # 1 minute for most apps
BROWSER_MIN_DURATION = 30  # browser tabs switch faster
IDLE_THRESHOLD = 300  # 5 minutes — pause session tracking while away
PERIODIC_FLUSH_SECONDS = 300
_TEST_PERIODIC_FLUSH_SECONDS = 60

_observer_running = False
_observer_thread: threading.Thread | None = None
_observer_lock = threading.Lock()


def periodic_flush_interval() -> int:
    if is_test_mode():
        return _TEST_PERIODIC_FLUSH_SECONDS
    return PERIODIC_FLUSH_SECONDS


def _is_browser_app(app: str) -> bool:
    return TRACKED_APPS.get(app) == "browser"


def _min_duration_for_app(app: str) -> int:
    if _is_browser_app(app):
        return BROWSER_MIN_DURATION
    return MIN_DURATION


def _parse_browser_domain(window_title: str) -> tuple[str, str] | None:
    """Map a browser window title to (domain, project_hint).

    Returns None when the session should be skipped (noisy mail tabs).
    """
    title = (window_title or "").strip()
    lower = title.lower()
    if not lower:
        return ("browser", "")

    if "gmail" in lower or "mail.google" in lower:
        return None
    if lower == "mail" or lower.startswith("mail —") or lower.startswith("mail -"):
        return None
    if re.search(r"\b(inbox|outlook|yahoo mail)\b", lower):
        return None

    if "claude.ai" in lower:
        return ("ai_tools", "claude")
    if "github.com" in lower or re.search(r"\bgithub\b", lower):
        return ("projects", "github")
    if "figma.com" in lower:
        return ("projects", "figma")
    if "localhost:3000" in lower or "127.0.0.1:3000" in lower:
        return ("projects", "air4")

    return ("browser", "")


def _resolve_session_metadata(
    app: str, window: str
) -> tuple[str, str] | None:
    """Return (domain, project_hint) for a session, or None to skip."""
    if _is_browser_app(app):
        return _parse_browser_domain(window)

    domain = TRACKED_APPS.get(app, "other")
    if domain == "other":
        return None
    return domain, extract_project_hint(app, window)


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


def get_idle_seconds() -> int:
    """Seconds since last keyboard/mouse input (macOS only)."""
    if sys.platform != "darwin":
        return 0
    result = subprocess.run(
        ["ioreg", "-c", "IOHIDSystem"],
        capture_output=True,
        text=True,
    )
    match = re.search(r'"HIDIdleTime"\s*=\s*(\d+)', result.stdout)
    if match:
        return int(match.group(1)) // 1_000_000_000
    return 0


def _flush_session(
    db_path: str,
    app: str | None,
    window: str | None,
    session_start: float | None,
    *,
    idle_seconds: int = 0,
) -> None:
    """Persist a tracked session if it meets the minimum duration."""
    if not app or session_start is None:
        return
    duration = max(0, int(time.time() - session_start) - idle_seconds)
    if duration < _min_duration_for_app(app):
        return
    meta = _resolve_session_metadata(app, window or "")
    if meta is None:
        return
    domain, project_hint = meta
    save_event(
        db_path,
        app,
        window or "",
        duration,
        domain,
        project_hint=project_hint,
    )


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


def _match_active_project(
    conn: sqlite3.Connection, project_hint: str
) -> sqlite3.Row | None:
    hint = project_hint.strip()
    if not hint:
        return None
    return conn.execute(
        """
        SELECT id, name FROM projects
        WHERE status = 'active'
          AND (
            LOWER(name) LIKE '%' || LOWER(?) || '%'
            OR LOWER(?) LIKE '%' || LOWER(name) || '%'
          )
        ORDER BY LENGTH(name) DESC
        LIMIT 1
        """,
        (hint, hint),
    ).fetchone()


def _log_observer_project_activity(
    conn: sqlite3.Connection,
    *,
    project_id: int,
    app: str,
    duration: int,
    observed_at: str,
) -> None:
    minutes = max(1, duration // 60)
    conn.execute(
        """
        INSERT INTO project_logs
        (project_id, note, log_type, duration_minutes, source, created_at)
        VALUES (?, ?, 'update', ?, 'observer', ?)
        """,
        (
            project_id,
            f"Observer: {app} активен {minutes} мин",
            minutes,
            observed_at,
        ),
    )
    conn.execute(
        "UPDATE projects SET updated_at = ? WHERE id = ?",
        (observed_at, project_id),
    )


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
    *,
    project_hint: str | None = None,
) -> None:
    print(f"👁 Saving: {app} | {window} | {duration}s | {domain}")
    hint = project_hint if project_hint is not None else extract_project_hint(app, window)
    observed_at = datetime.now().isoformat()
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
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
                hint,
                observed_at,
            ),
        )

        if hint:
            project = _match_active_project(conn, hint)
            if project is not None:
                _log_observer_project_activity(
                    conn,
                    project_id=int(project["id"]),
                    app=app,
                    duration=duration,
                    observed_at=observed_at,
                )
                print(
                    f"👁 Linked to project {project['name']} "
                    f"(#{project['id']})"
                )

        conn.commit()
    finally:
        conn.close()


def run_observer(db_path: str | None = None) -> None:
    global _observer_running
    path = db_path or str(DB_PATH)
    _observer_running = True

    current_app: str | None = None
    current_window: str | None = None
    session_start: float | None = None
    last_flush_time = time.time()
    flush_interval = periodic_flush_interval()
    check_interval = 10

    print("👁 Observer started")

    while _observer_running:
        try:
            if not is_observer_enabled(path):
                time.sleep(30)
                continue

            idle = get_idle_seconds()
            if idle > IDLE_THRESHOLD:
                if current_app and session_start:
                    print(f"👁 Idle {idle}s — closing session for {current_app}")
                    _flush_session(
                        path,
                        current_app,
                        current_window,
                        session_start,
                        idle_seconds=idle,
                    )
                    current_app = None
                    current_window = None
                    session_start = None
                time.sleep(check_interval)
                continue

            active = get_active_app()
            app = active["app"]
            window = active["window"]

            if app != current_app or window != current_window:
                print(f"👁 Switch detected: {current_app} → {app}")
                if current_app and session_start:
                    _flush_session(
                        path,
                        current_app,
                        current_window,
                        session_start,
                    )

                current_app = app
                current_window = window
                session_start = time.time()

            now = time.time()
            if now - last_flush_time >= flush_interval:
                if current_app and session_start:
                    duration = int(now - session_start)
                    if duration >= _min_duration_for_app(current_app):
                        meta = _resolve_session_metadata(
                            current_app, current_window or ""
                        )
                        if meta is not None:
                            domain, project_hint = meta
                            save_event(
                                path,
                                current_app,
                                current_window or "",
                                duration,
                                domain,
                                project_hint=project_hint,
                            )
                            print(
                                f"👁 Periodic flush: {current_app} — "
                                f"{duration // 60}мин"
                            )
                            session_start = time.time()
                last_flush_time = now

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
