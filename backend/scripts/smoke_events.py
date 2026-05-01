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
        if text == "bench press 80x8" and md["domain"] != "training":
            _fail(f'"bench press 80x8" metadata.domain == "training", got {md["domain"]!r}')
        if text == "spent 40€ on groceries" and md["domain"] != "finance":
            _fail(f'"spent 40€ on groceries" metadata.domain == "finance", got {md["domain"]!r}')
        if text == "idea: simplify event schema" and md["domain"] != "idea":
            _fail(f'"idea: simplify event schema" metadata.domain == "idea", got {md["domain"]!r}')
        if text == "slept only 5 hours" and md["domain"] != "health":
            _fail(f'"slept only 5 hours" metadata.domain == "health", got {md["domain"]!r}')
        if text == "worked on AIR4 architecture" and md["domain"] != "project":
            _fail(
                f'"worked on AIR4 architecture" metadata.domain == "project", got {md["domain"]!r}'
            )
        if "AIR4" in text:
            air4_id = body["id"]

    _pass("POST /event creates events with expected fields and Observer v1 domains (5 samples)")

    if air4_id is None:
        _fail("AIR4 sample event not tracked")

    lst = client.get("/events", params={"limit": 50})
    if lst.status_code != 200:
        _fail(f"GET /events failed: {lst.status_code} {lst.text}")
    lst_body = lst.json()
    if not isinstance(lst_body, dict) or "items" not in lst_body:
        _fail("GET /events should return an object with 'items'")
    events = lst_body["items"]
    if lst_body.get("count") != len(events):
        _fail(f"GET /events count mismatch: count={lst_body.get('count')!r} len={len(events)}")
    if not isinstance(events, list):
        _fail("GET /events items should be a list")
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
    sr_body = sr.json()
    if not isinstance(sr_body, dict) or "items" not in sr_body:
        _fail("GET /search should return an object with 'items'")
    found = sr_body["items"]
    if sr_body.get("query") != "AIR4":
        _fail(f"GET /search query echo expected 'AIR4', got {sr_body.get('query')!r}")
    if sr_body.get("count") != len(found):
        _fail(f"GET /search count mismatch: count={sr_body.get('count')!r} len={len(found)}")
    if not isinstance(found, list) or not found:
        _fail("GET /search?q=AIR4 should return a non-empty items list")
    top_ids = {e["id"] for e in found}
    if air4_id not in top_ids:
        _fail(f"AIR4 event {air4_id} not in search results: {top_ids}")
    _pass("GET /search?q=AIR4 returns the AIR4 event")

    ch = client.post("/chat", json={"message": "What did I work on with AIR4?"})
    if ch.status_code != 200:
        _fail(f"POST /chat failed: {ch.status_code} {ch.text}")
    ch_body = ch.json()
    if "answer" not in ch_body:
        _fail("POST /chat response missing 'answer'")
    if "events_used" not in ch_body:
        _fail("POST /chat response missing 'events_used'")
    if not isinstance(ch_body.get("events_used"), list):
        _fail("POST /chat events_used must be a list")
    _pass("POST /chat returns answer and events_used")

    day_str = events[0]["timestamp"].split("T")[0]
    gen = client.post(f"/time/daily/{day_str}")
    if gen.status_code != 200:
        _fail(f"POST /time/daily/{{date}} failed: {gen.status_code} {gen.text}")
    gen_body = gen.json()
    for k in ("id", "date", "summary_text", "event_ids", "created_at"):
        if k not in gen_body:
            _fail(f"daily summary response missing {k!r}")
    if gen_body.get("date") != day_str:
        _fail(f"daily summary date expected {day_str!r}, got {gen_body.get('date')!r}")
    if "Today included:" not in gen_body.get("summary_text", ""):
        _fail("daily summary_text should include 'Today included:'")
    if not isinstance(gen_body.get("event_ids"), list) or len(gen_body["event_ids"]) != len(
        SAMPLES
    ):
        _fail("daily summary event_ids should include all events for that day")
    fetch = client.get(f"/time/daily/{day_str}")
    if fetch.status_code != 200:
        _fail(f"GET /time/daily/{{date}} failed: {fetch.status_code} {fetch.text}")
    if fetch.json().get("id") != gen_body.get("id"):
        _fail("GET /time/daily should return same summary as POST generated")
    _pass("POST/GET /time/daily/{date} daily summary")

    wk = client.post(f"/time/weekly/{day_str}")
    if wk.status_code != 200:
        _fail(f"POST /time/weekly/{{week_start}} failed: {wk.status_code} {wk.text}")
    wk_body = wk.json()
    for k in ("id", "week_start_date", "reflection_text", "daily_summary_ids", "created_at"):
        if k not in wk_body:
            _fail(f"weekly reflection response missing {k!r}")
    if wk_body.get("week_start_date") != day_str:
        _fail(f"week_start_date expected {day_str!r}, got {wk_body.get('week_start_date')!r}")
    if gen_body.get("id") not in wk_body.get("daily_summary_ids", []):
        _fail("weekly reflection should reference the generated daily summary id")
    if "This week included:" not in wk_body.get("reflection_text", ""):
        _fail("reflection_text should include 'This week included:'")
    if "Most active domain:" not in wk_body.get("reflection_text", ""):
        _fail("reflection_text should include 'Most active domain:'")
    wk_get = client.get(f"/time/weekly/{day_str}")
    if wk_get.status_code != 200:
        _fail(f"GET /time/weekly/{{week_start}} failed: {wk_get.status_code} {wk_get.text}")
    if wk_get.json().get("id") != wk_body.get("id"):
        _fail("GET /time/weekly should return same reflection as POST generated")
    _pass("POST/GET /time/weekly/{week_start} weekly reflection")

    month_str = day_str[:7]
    mo = client.post(f"/time/monthly/{month_str}")
    if mo.status_code != 200:
        _fail(f"POST /time/monthly/{{month}} failed: {mo.status_code} {mo.text}")
    mo_body = mo.json()
    for k in ("id", "month", "summary_text", "weekly_reflection_ids", "created_at"):
        if k not in mo_body:
            _fail(f"monthly summary response missing {k!r}")
    if mo_body.get("month") != month_str:
        _fail(f"month expected {month_str!r}, got {mo_body.get('month')!r}")
    if wk_body.get("id") not in mo_body.get("weekly_reflection_ids", []):
        _fail("monthly summary should reference the generated weekly reflection id")
    if "This month included:" not in mo_body.get("summary_text", ""):
        _fail("monthly summary_text should include 'This month included:'")
    if "Most active domain:" not in mo_body.get("summary_text", ""):
        _fail("monthly summary_text should include 'Most active domain:'")
    mo_get = client.get(f"/time/monthly/{month_str}")
    if mo_get.status_code != 200:
        _fail(f"GET /time/monthly/{{month}} failed: {mo_get.status_code} {mo_get.text}")
    if mo_get.json().get("id") != mo_body.get("id"):
        _fail("GET /time/monthly should return same summary as POST generated")
    _pass("POST/GET /time/monthly/{month} monthly summary")

    rb = client.post(f"/time/rebuild/{day_str}")
    if rb.status_code != 200:
        _fail(f"POST /time/rebuild/{{date}} failed: {rb.status_code} {rb.text}")
    rb_body = rb.json()
    for key in ("daily_summary", "weekly_reflection", "monthly_summary"):
        if key not in rb_body:
            _fail(f"rebuild response missing {key!r}")
        sub = rb_body[key]
        if not isinstance(sub, dict):
            _fail(f"rebuild {key} must be an object")
    ds_r = rb_body["daily_summary"]
    wr_r = rb_body["weekly_reflection"]
    ms_r = rb_body["monthly_summary"]
    for k in ("id", "date", "summary_text", "event_ids", "created_at"):
        if k not in ds_r:
            _fail(f"rebuild daily_summary missing {k!r}")
    for k in ("id", "week_start_date", "reflection_text", "daily_summary_ids", "created_at"):
        if k not in wr_r:
            _fail(f"rebuild weekly_reflection missing {k!r}")
    for k in ("id", "month", "summary_text", "weekly_reflection_ids", "created_at"):
        if k not in ms_r:
            _fail(f"rebuild monthly_summary missing {k!r}")
    _pass("POST /time/rebuild/{date} builds all three time layers")

    wk_meaning = wr_r["week_start_date"]
    mg = client.post(f"/meaning/week/{wk_meaning}")
    if mg.status_code != 200:
        _fail(f"POST /meaning/week/{{week_start}} failed: {mg.status_code} {mg.text}")
    mg_body = mg.json()
    if "items" not in mg_body:
        _fail("POST /meaning/week response missing 'items'")

    all_m = client.get("/meanings")
    if all_m.status_code != 200:
        _fail(f"GET /meanings failed: {all_m.status_code} {all_m.text}")
    all_body = all_m.json()
    if "items" not in all_body:
        _fail("GET /meanings response missing 'items'")
    meanings_list = all_body["items"]
    if not isinstance(meanings_list, list) or len(meanings_list) < 1:
        _fail("expected at least one meaning after weekly generation")
    first_id = meanings_list[0]["id"]
    cfm = client.post(f"/meaning/confirm/{first_id}")
    if cfm.status_code != 200:
        _fail(f"POST /meaning/confirm failed: {cfm.status_code} {cfm.text}")
    if cfm.json().get("status") != "confirmed":
        _fail("confirmed meaning should have status confirmed")
    if len(meanings_list) >= 2:
        second_id = meanings_list[1]["id"]
        rej = client.post(f"/meaning/reject/{second_id}")
        if rej.status_code != 200:
            _fail(f"POST /meaning/reject failed: {rej.status_code} {rej.text}")
        if rej.json().get("status") != "rejected":
            _fail("rejected meaning should have status rejected")
    final_m = client.get("/meanings")
    if final_m.status_code != 200 or "items" not in final_m.json():
        _fail("GET /meanings after confirm/reject should return items")
    _pass("meaning week generation, confirm/reject, GET /meanings")

    bh = client.post("/meaning/hypotheses/generate")
    if bh.status_code != 200:
        _fail(f"POST /meaning/hypotheses/generate failed: {bh.status_code} {bh.text}")
    bhj = bh.json()
    if "items" not in bhj or "count" not in bhj:
        _fail("behavior hypotheses response must include 'items' and 'count'")
    if not isinstance(bhj["items"], list) or bhj["count"] != len(bhj["items"]):
        _fail("behavior hypotheses count must match items length")
    all_meaning_ids = {x["id"] for x in client.get("/meanings").json()["items"]}
    for it in bhj["items"]:
        if it.get("source") != "behavior_hypothesis_v1":
            _fail("generated behavior hypothesis must have source behavior_hypothesis_v1")
        md = it.get("metadata") or {}
        for k in ("supporting_weeks", "supporting_meanings", "confidence_score"):
            if k not in md:
                _fail(f"behavior hypothesis metadata missing {k!r}")
        cs = float(md["confidence_score"])
        if not 0.1 <= cs <= 0.9:
            _fail("confidence_score must be between 0.1 and 0.9")
        if it["id"] not in all_meaning_ids:
            _fail("behavior hypothesis must be persisted (visible in GET /meanings)")
    _pass("POST /meaning/hypotheses/generate behavior hypotheses")

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
