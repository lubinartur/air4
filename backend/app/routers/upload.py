from __future__ import annotations

from collections import Counter
from typing import Annotated

import aiosqlite
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.database import execute, fetch_one, get_db
from app.models.transaction import UploadSummaryOut
from app.services.categorizer import OllamaCategorizer
from app.services.parser import mark_internal_transfers, parse_swedbank_csv, period_range


router = APIRouter()


@router.post("/upload", response_model=UploadSummaryOut)
async def upload(
    files: Annotated[list[UploadFile], File(...)],
    db: aiosqlite.Connection = Depends(get_db),
) -> UploadSummaryOut:
    if not files or len(files) > 2:
        raise HTTPException(status_code=400, detail="Upload one or two CSV files.")

    all_txns = []
    filenames = []
    for f in files:
        filenames.append(f.filename or "statement.csv")
        content = await f.read()
        txns = parse_swedbank_csv(content)
        all_txns.extend(txns)

    if not all_txns:
        raise HTTPException(status_code=400, detail="No transactions found in CSV.")

    mark_internal_transfers(all_txns)
    period_start, period_end = period_range(all_txns)
    account_ibans = sorted({t.account_iban for t in all_txns if t.account_iban})

    upload_id = await execute(
        db,
        """
        INSERT INTO uploads (filename, account_iban, period_start, period_end, total_transactions)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            ", ".join(filenames),
            account_ibans[0] if account_ibans else None,
            period_start,
            period_end,
            len(all_txns),
        ),
    )

    categorizer = OllamaCategorizer()
    categories = await categorizer.categorize(all_txns)

    insert_sql = """
        INSERT INTO transactions
        (upload_id, date, description, amount, currency, category, category_confirmed,
         account_iban, is_debit, is_internal_transfer, raw_description)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """
    params = []
    for t, cat in zip(all_txns, categories, strict=False):
        params.append(
            (
                upload_id,
                t.date.isoformat(),
                t.description,
                float(t.amount),
                t.currency,
                cat or "other",
                False,
                t.account_iban,
                bool(t.is_debit),
                bool(t.is_internal_transfer),
                t.raw_description,
            )
        )
    await db.executemany(insert_sql, params)
    await db.commit()

    counts = Counter([c or "other" for c in categories])

    return UploadSummaryOut(
        upload_id=upload_id,
        filename=", ".join(filenames),
        account_ibans=account_ibans,
        period_start=period_start,
        period_end=period_end,
        total_transactions=len(all_txns),
        categories=dict(counts),
    )

