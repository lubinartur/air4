from __future__ import annotations

import hashlib
from collections import Counter
from typing import Annotated

from fastapi import APIRouter, File, HTTPException, UploadFile

from database import execute, fetch_one, get_db
from schemas import UploadSummaryOut
from services.categorizer import categorize
from services.parser import (
    TransactionIn,
    mark_internal_transfers,
    mark_internal_transfers_in_db,
    parse_swedbank_csv,
    period_range,
    primary_iban_from_transactions,
    register_known_ibans,
    sync_known_ibans_from_db,
)

router = APIRouter()


@router.get("/uploads")
def get_uploads() -> list[dict]:
    with get_db() as conn:
        uploads = conn.execute(
            """
            SELECT id, filename, account_iban, period_start,
                   period_end, total_transactions, created_at
            FROM uploads
            ORDER BY created_at DESC
            """
        ).fetchall()
        return [dict(u) for u in uploads]


@router.delete("/uploads/{upload_id}")
def delete_upload(upload_id: int) -> dict:
    with get_db() as conn:
        row = fetch_one(conn, "SELECT id FROM uploads WHERE id = ?", (upload_id,))
        if row is None:
            raise HTTPException(status_code=404, detail="Upload not found")

        count_row = conn.execute(
            "SELECT COUNT(*) FROM transactions WHERE upload_id = ?",
            (upload_id,),
        ).fetchone()
        count = int(count_row[0]) if count_row else 0

        conn.execute("DELETE FROM transactions WHERE upload_id = ?", (upload_id,))
        conn.execute("DELETE FROM uploads WHERE id = ?", (upload_id,))
        conn.commit()

    return {"deleted": True, "transactions_removed": count}


def _transaction_hash(txn: TransactionIn) -> str:
    raw = f"{txn.date.isoformat()}|{txn.amount:.2f}|{txn.description}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _process_one_file(
    conn,
    filename: str,
    txns: list[TransactionIn],
    categories: list[str],
) -> tuple[int, int, int, Counter]:
    """Insert one upload + transactions; return upload_id, new_count, skipped, categories."""
    file_iban = primary_iban_from_transactions(txns)
    if file_iban:
        register_known_ibans([file_iban])

    period_start, period_end = period_range(txns)

    upload_id = execute(
        conn,
        """
        INSERT INTO uploads (filename, account_iban, period_start, period_end, total_transactions)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            filename,
            file_iban,
            period_start,
            period_end,
            len(txns),
        ),
    )

    insert_sql = """
        INSERT OR IGNORE INTO transactions
        (upload_id, transaction_hash, date, description, amount, currency, category,
         category_confirmed, account_iban, is_debit, is_internal_transfer, raw_description)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
    """
    new_count = 0
    skipped = 0
    saved_categories: list[str] = []

    for txn, cat in zip(txns, categories, strict=False):
        tx_hash = _transaction_hash(txn)
        existing = fetch_one(
            conn,
            "SELECT id FROM transactions WHERE transaction_hash = ?",
            (tx_hash,),
        )
        if existing:
            skipped += 1
            continue

        cur = conn.execute(
            insert_sql,
            (
                upload_id,
                tx_hash,
                txn.date.isoformat(),
                txn.description,
                float(txn.amount),
                txn.currency,
                cat or "other",
                txn.account_iban or None,
                1 if txn.is_debit else 0,
                1 if txn.is_internal_transfer else 0,
                txn.raw_description,
            ),
        )
        if cur.rowcount:
            new_count += 1
            saved_categories.append(cat or "other")

    conn.commit()
    mark_internal_transfers_in_db(conn)

    return upload_id, new_count, skipped, Counter(saved_categories)


@router.post("/upload", response_model=UploadSummaryOut)
def upload(
    file: Annotated[UploadFile | None, File()] = None,
    files: Annotated[list[UploadFile] | None, File()] = None,
) -> UploadSummaryOut:
    uploaded: list[UploadFile] = []
    if file is not None:
        uploaded.append(file)
    if files:
        uploaded.extend(files)
    if not uploaded or len(uploaded) > 2:
        raise HTTPException(status_code=400, detail="Upload one or two CSV files.")

    owner_name: str | None = None
    with get_db() as conn:
        profile = fetch_one(conn, "SELECT name FROM user_profile WHERE id = 1")
        if profile and profile.get("name"):
            owner_name = str(profile["name"])
        sync_known_ibans_from_db(conn)

    last_result: UploadSummaryOut | None = None

    for f in uploaded:
        filename = f.filename or "statement.csv"
        content = f.file.read()
        txns = parse_swedbank_csv(content)

        if not txns:
            raise HTTPException(
                status_code=400,
                detail=f"No transactions found in {filename}.",
            )

        file_ibans = {t.account_iban for t in txns if t.account_iban}
        register_known_ibans(file_ibans)
        mark_internal_transfers(txns, owner_name=owner_name, known_ibans=file_ibans)
        categories = categorize(txns)
        account_ibans = sorted(file_ibans)

        with get_db() as conn:
            sync_known_ibans_from_db(conn)
            upload_id, new_count, skipped, counts = _process_one_file(
                conn, filename, txns, categories
            )

        period_start, period_end = period_range(txns)
        last_result = UploadSummaryOut(
            upload_id=upload_id,
            filename=filename,
            account_ibans=account_ibans,
            period_start=period_start,
            period_end=period_end,
            total_transactions=len(txns),
            new_transactions=new_count,
            skipped_duplicates=skipped,
            categories=dict(counts),
        )

    assert last_result is not None
    return last_result
