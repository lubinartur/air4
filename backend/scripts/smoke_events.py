#!/usr/bin/env python3
"""End-to-end smoke test for Event Memory (FastAPI TestClient, isolated SQLite file)."""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

# Backend root must be on sys.path when invoked as `python scripts/smoke_events.py`
_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

_fd, _db_path = tempfile.mkstemp(suffix=".db")
os.close(_fd)
os.environ["AIR4_SQLITE_PATH"] = _db_path

from fastapi.testclient import TestClient  # noqa: E402

from app.db import Base, engine  # noqa: E402
import app.models  # noqa: F401, E402
from app.main import app  # noqa: E402

SAMPLES = [
    "worked on AIR4 architecture",
    "bench press 80x8",
    "idea: simplify event schema",
    "spent 40€ on groceries",
    "slept only 5 hours",
]

EXPECTED_DOMAIN_BY_TEXT: dict[str, str] = {
    "worked on AIR4 architecture": "project",
    "bench press 80x8": "training",
    "idea: simplify event schema": "idea",
    "spent 40€ on groceries": "finance",
    "slept only 5 hours": "health",
}

REQUIRED_METADATA_KEYS = frozenset(
    {"domain", "source", "raw_length", "parser_version", "signals"},
)

REQUIRED_POST_KEYS = frozenset(
    {"id", "timestamp", "original_text", "processed_text", "metadata", "embedding_id"}
)


def _fail(msg: str) -> None:
    print(f"FAIL: {msg}")
    raise SystemExit(1)


def _pass(msg: str) -> None:
    print(f"PASS: {msg}")


def main() -> None:
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    client = TestClient(app)

    # GET /health
    h = client.get("/health")
    if h.status_code != 200 or h.json() != {"status": "ok"}:
        _fail(f"/health expected {{'status': 'ok'}}, got {h.status_code} {h.text}")
    _pass("GET /health returns ok")

    air4_id: str | None = None

    for text in SAMPLES:
        r = client.post("/event", json={"text": text})
        if r.status_code != 200:
            _fail(f"POST /event failed for {text!r}: {r.status_code} {r.text}")
        body = r.json()
        missing = REQUIRED_POST_KEYS - body.keys()
        if missing:
            _fail(f"POST /event missing keys {sorted(missing)}; got {sorted(body.keys())}")
        for k in REQUIRED_POST_KEYS:
            if body[k] is None and k != "embedding_id":
                _fail(f"POST /event field {k} is null")
        if body["embedding_id"] is None:
            _fail("POST /event embedding_id should be set")
        if body["original_text"] != text:
            _fail(f"original_text mismatch: {body['original_text']!r} != {text!r}")
        if not isinstance(body["metadata"], dict):
            _fail("metadata should be a dict")
        md = body["metadata"]
        miss_md = REQUIRED_METADATA_KEYS - md.keys()
        if miss_md:
            _fail(f"metadata missing keys {sorted(miss_md)}")
        if md.get("source") != "manual":
            _fail(f"metadata.source expected 'manual', got {md.get('source')!r}")
        if md.get("parser_version") != "v1":
            _fail(f"metadata.parser_version expected 'v1', got {md.get('parser_version')!r}")
        if not isinstance(md.get("signals"), list):
            _fail("metadata.signals must be a list")
        expected_domain = EXPECTED_DOMAIN_BY_TEXT.get(text)
        if expected_domain and md.get("domain") != expected_domain:
            _fail(
                f"metadata.domain for {text!r}: expected {expected_domain!r}, got {md.get('domain')!r}"
            )
        if "AIR4" in text:
            air4_id = body["id"]

    _pass("POST /event creates events with expected fields and Observer v1 domains (5 samples)")

    if air4_id is None:
        _fail("AIR4 sample event not tracked")

    lst = client.get("/events", params={"limit": 50})
    if lst.status_code != 200:
        _fail(f"GET /events failed: {lst.status_code} {lst.text}")
    events = lst.json()
    if not isinstance(events, list):
        _fail("GET /events should return a list")
    originals = {e.get("original_text") for e in events}
    for text in SAMPLES:
        if text not in originals:
            _fail(f"GET /events missing sample {text!r}; got {originals!r}")
    # newest first: first item should be last posted sample
    if events[0]["original_text"] != SAMPLES[-1]:
        _fail(f"GET /events not newest-first: first is {events[0]['original_text']!r}")
    _pass("GET /events returns all samples, newest first")

    sr = client.get("/search", params={"q": "AIR4", "limit": 10})
    if sr.status_code != 200:
        _fail(f"GET /search failed: {sr.status_code} {sr.text}")
    found = sr.json()
    if not isinstance(found, list) or not found:
        _fail("GET /search?q=AIR4 should return a non-empty list")
    top_ids = {e["id"] for e in found}
    if air4_id not in top_ids:
        _fail(f"AIR4 event {air4_id} not in search results: {top_ids}")
    _pass("GET /search?q=AIR4 returns the AIR4 event")

    print("")
    print("ALL CHECKS PASSED")


if __name__ == "__main__":
    try:
        main()
    finally:
        try:
            os.unlink(_db_path)
        except OSError:
            pass
