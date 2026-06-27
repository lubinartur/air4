"""AIR4 test-mode toggles — lower proactive thresholds for local QA."""

from __future__ import annotations

import os


def is_test_mode() -> bool:
    return os.getenv("AIRCH_TEST_MODE", "").strip().lower() in ("1", "true", "yes")
