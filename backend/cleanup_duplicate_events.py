#!/usr/bin/env python3
"""One-off cleanup for duplicate rows in the `events` table.

Within each date, build connected components of `events` rows whose
normalized titles have `difflib.SequenceMatcher.ratio() > THRESHOLD`.
For each multi-row component:
    • keep the row with the longest `description`
      (tie → lowest `id`),
    • delete every other row.

Threshold is **adaptive per-date** to avoid over-merging on busy days:
    • Default threshold: 0.5 — catches everyday rephrasings ("Сдать
      анализы" ↔ "Сдача анализов").
    • If the date produces more than 5 duplicate groups at 0.5, the
      day is treated as "high-traffic": re-clustered at 0.75 so very
      different events ("Велоремонт" ↔ "Велопрогулка") aren't
      collapsed into a single bucket. 2026-05-22 was the canary that
      surfaced this — at 0.5 it was lumping semantically different
      rows together purely because they shared a verb stem.

The script is dry-run by default — re-run with `--apply` to commit the
deletions. `--date YYYY-MM-DD` restricts the pass to one date for
focused cleanups.

Limitations to be aware of:
    • `SequenceMatcher` works on character overlap. Cross-language
      duplicates like "Сдать анализы" ↔ "Blood tests" share no
      characters and will stay as separate canonical rows. Those need
      a manual or LLM-based reconciliation pass.
    • Rows referenced by `workouts.event_id` are protected and never
      deleted — this script logs them and skips deletion so foreign
      references don't dangle.

Usage:
    python3 cleanup_duplicate_events.py                   # dry-run, all dates
    python3 cleanup_duplicate_events.py --date 2026-05-29 # dry-run, one date
    python3 cleanup_duplicate_events.py --date 2026-05-29 --apply
"""
from __future__ import annotations

import argparse
import re
import sqlite3
import sys
from collections import defaultdict
from difflib import SequenceMatcher
from typing import Any

from database import DB_PATH

# Default similarity threshold — catches typical LLM rephrasings.
_DEFAULT_THRESHOLD = 0.5
# Stricter threshold used on busy days. Empirically, days with many
# duplicate groups at 0.5 also tend to contain genuinely distinct
# events sharing a stem (verb root, location word), and 0.5 over-merges
# them. 0.75 keeps real rephrasings ("Сдать анализы" / "Сдача
# анализов" ≈ 0.77) while breaking apart accidental matches.
_STRICTER_THRESHOLD = 0.75
# Trigger to switch a date from default to stricter threshold. Picked
# from inspection of 2026-05-22 — the date the user flagged as
# over-merging at 0.5.
_GROUP_COUNT_TRIGGER = 5


def _normalize_title(text: str) -> str:
    """Match `event_extractor._normalize_title` so cleanup and live
    dedup behave the same way."""
    s = (text or "").strip().lower()
    s = re.sub(r"[\u2010-\u2015\-]", " ", s)
    s = re.sub(r"[^\w\s]", " ", s, flags=re.UNICODE)
    s = re.sub(r"\s+", " ", s).strip()
    return s


class _UnionFind:
    def __init__(self, n: int) -> None:
        self.parent = list(range(n))

    def find(self, x: int) -> int:
        # Iterative path compression — recursion would blow the stack
        # on extreme inputs and is unnecessary here.
        root = x
        while self.parent[root] != root:
            root = self.parent[root]
        while self.parent[x] != root:
            self.parent[x], x = root, self.parent[x]
        return root

    def union(self, x: int, y: int) -> None:
        rx, ry = self.find(x), self.find(y)
        if rx != ry:
            self.parent[rx] = ry


def _cluster(
    rows: list[dict[str, Any]], threshold: float
) -> list[list[dict[str, Any]]]:
    """Group `rows` (same date) into connected components by title
    similarity > `threshold`. Returns only the components with ≥2
    members."""
    n = len(rows)
    uf = _UnionFind(n)
    norms = [_normalize_title(str(r.get("title") or "")) for r in rows]
    for i in range(n):
        if not norms[i]:
            continue
        for j in range(i + 1, n):
            if not norms[j]:
                continue
            ratio = SequenceMatcher(None, norms[i], norms[j]).ratio()
            if ratio > threshold:
                uf.union(i, j)
    buckets: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for i, r in enumerate(rows):
        buckets[uf.find(i)].append(r)
    return [g for g in buckets.values() if len(g) >= 2]


def _cluster_for_date(
    rows: list[dict[str, Any]],
) -> tuple[list[list[dict[str, Any]]], float]:
    """Cluster a single date's rows with adaptive threshold.

    Start at the default threshold; if the result has more groups than
    `_GROUP_COUNT_TRIGGER`, redo the clustering at `_STRICTER_THRESHOLD`
    on the assumption that the day is genuinely diverse and 0.5 is
    over-collapsing distinct events. Returns the chosen groups and the
    threshold that produced them (for logging)."""
    groups = _cluster(rows, _DEFAULT_THRESHOLD)
    if len(groups) > _GROUP_COUNT_TRIGGER:
        groups = _cluster(rows, _STRICTER_THRESHOLD)
        return groups, _STRICTER_THRESHOLD
    return groups, _DEFAULT_THRESHOLD


def _keep_key(row: dict[str, Any]) -> tuple[int, int]:
    """Longer description wins. Tie → lowest id wins (so canonical
    rows stay stable across reruns)."""
    desc_len = len(str(row.get("description") or ""))
    # Negate id so max() picks the smallest one as the tiebreaker.
    return (desc_len, -int(row["id"]))


def _referenced_event_ids(conn: sqlite3.Connection, ids: list[int]) -> set[int]:
    """IDs in `ids` that some `workouts` row points at via `event_id`.
    Those rows must not be deleted — that's the only declared cross-
    table reference into `events`."""
    if not ids:
        return set()
    placeholders = ",".join("?" for _ in ids)
    cur = conn.execute(
        f"SELECT DISTINCT event_id FROM workouts "
        f"WHERE event_id IS NOT NULL AND event_id IN ({placeholders})",
        ids,
    )
    return {int(r[0]) for r in cur.fetchall()}


def _format_row(row: dict[str, Any], action: str) -> str:
    desc_len = len(str(row.get("description") or ""))
    return (
        f"  {action} id={int(row['id']):>5} "
        f"desc_len={desc_len:>4} "
        f"cat={str(row.get('category') or '-'):<10} "
        f"title={row.get('title')!r}"
    )


def _load_rows(
    conn: sqlite3.Connection, date_filter: str | None
) -> list[dict[str, Any]]:
    conn.row_factory = sqlite3.Row
    if date_filter:
        cur = conn.execute(
            """
            SELECT id, date, title, description, category
            FROM events
            WHERE date = ?
            ORDER BY id
            """,
            (date_filter,),
        )
    else:
        cur = conn.execute(
            """
            SELECT id, date, title, description, category
            FROM events
            WHERE date IS NOT NULL AND date != ''
            ORDER BY date, id
            """
        )
    return [dict(r) for r in cur.fetchall()]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually delete duplicate rows. Default is dry-run.",
    )
    parser.add_argument(
        "--date",
        default=None,
        help="Limit to a single date YYYY-MM-DD (default: all dates).",
    )
    args = parser.parse_args(argv)

    with sqlite3.connect(DB_PATH) as conn:
        rows = _load_rows(conn, args.date)
        if not rows:
            print("No events to scan.")
            return 0

        by_date: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for r in rows:
            by_date[str(r["date"])].append(r)

        delete_ids: list[int] = []
        skipped_dates = 0
        stricter_dates = 0
        for d in sorted(by_date):
            day_rows = by_date[d]
            groups, threshold = _cluster_for_date(day_rows)
            if not groups:
                skipped_dates += 1
                continue
            if threshold == _STRICTER_THRESHOLD:
                stricter_dates += 1
            print(
                f"\n=== {d} "
                f"({len(groups)} duplicate group(s), threshold={threshold}) ==="
            )
            for grp in groups:
                keeper = max(grp, key=_keep_key)
                losers = [r for r in grp if int(r["id"]) != int(keeper["id"])]
                print(_format_row(keeper, "KEEP"))
                for r in losers:
                    print(_format_row(r, " DEL"))
                    delete_ids.append(int(r["id"]))

        # Strip out any IDs referenced by workouts.event_id — deleting
        # them would leave dangling references.
        referenced = _referenced_event_ids(conn, delete_ids)
        if referenced:
            print(
                f"\nProtected from deletion (referenced by workouts.event_id): "
                f"{sorted(referenced)}"
            )
            delete_ids = [i for i in delete_ids if i not in referenced]

        print(
            f"\nScanned: {len(rows)} row(s) across {len(by_date)} date(s); "
            f"{skipped_dates} date(s) had no duplicate groups; "
            f"{stricter_dates} date(s) switched to threshold "
            f"{_STRICTER_THRESHOLD} (>{_GROUP_COUNT_TRIGGER} groups at "
            f"{_DEFAULT_THRESHOLD})."
        )
        print(f"Would delete: {len(delete_ids)} row(s).")

        if not args.apply:
            print("Dry-run only. Re-run with --apply to commit deletions.")
            return 0

        if not delete_ids:
            print("Nothing to delete.")
            return 0

        conn.executemany(
            "DELETE FROM events WHERE id = ?",
            [(i,) for i in delete_ids],
        )
        conn.commit()
        print(f"Deleted {len(delete_ids)} row(s).")
        return 0


if __name__ == "__main__":
    sys.exit(main())
