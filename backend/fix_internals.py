"""One-off: mark internal transfers between owner Swedbank accounts."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from services.parser import mark_internal_transfers_in_db, sync_known_ibans_from_db

DB_PATH = Path(__file__).resolve().parent / "data" / "air4.db"


def main() -> None:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        sync_known_ibans_from_db(conn)
        newly = mark_internal_transfers_in_db(conn)
        total = conn.execute(
            "SELECT COUNT(*) FROM transactions WHERE is_internal_transfer = 1"
        ).fetchone()[0]
        print(f"Newly marked this run: {newly}")
        print(f"Total internal transfers: {total}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
