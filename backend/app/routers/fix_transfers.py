from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime

import aiosqlite
from fastapi import APIRouter, Depends

from app.database import fetch_all, get_db

router = APIRouter()

IBAN_A = "EE922200221039353138"
IBAN_B = "EE982200221067340731"


def _parse_tx_date(v: object) -> date | None:
    s = str(v or "").strip()
    if not s:
        return None
    try:
        # ISO date
        if len(s) >= 10 and s[4] == "-" and s[7] == "-":
            return date.fromisoformat(s[:10])
    except ValueError:
        pass
    for fmt in ("%d.%m.%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s[:10], fmt).date()
        except ValueError:
            continue
    return None


@dataclass(frozen=True)
class _Txn:
    id: int
    d: date
    amount_key: int
    is_debit: bool
    account_iban: str


@router.post("/fix-transfers")
async def fix_transfers(
    db: aiosqlite.Connection = Depends(get_db),
) -> dict[str, int]:
    """
    Post-processing fix for internal transfers that weren't detected at import time.
    Scans *all* uploads and marks matching pairs as is_internal_transfer = true.
    """
    rows = await fetch_all(
        db,
        """
        SELECT id, date, amount, is_debit, account_iban, description
        FROM transactions
        WHERE (description LIKE '%Ulekanne%' OR description LIKE '%ulekanne%'
               OR description LIKE '%Credit repayment%' OR description LIKE '%credit repayment%')
          AND account_iban IN (?, ?)
        ORDER BY date ASC, id ASC
        """,
        (IBAN_A, IBAN_B),
    )

    txs: list[_Txn] = []
    for r in rows:
        dt = _parse_tx_date(r.get("date"))
        if dt is None:
            continue
        try:
            amt = float(r.get("amount") or 0.0)
        except (TypeError, ValueError):
            continue
        amount_key = int(round(abs(amt) * 100))
        txs.append(
            _Txn(
                id=int(r["id"]),
                d=dt,
                amount_key=amount_key,
                is_debit=bool(r.get("is_debit")),
                account_iban=str(r.get("account_iban") or ""),
            )
        )

    # Group by amount, then match debit/credit across the two IBANs within ±3 days.
    by_amount: dict[int, list[_Txn]] = {}
    for t in txs:
        by_amount.setdefault(t.amount_key, []).append(t)

    marked: set[int] = set()
    pairs = 0
    for group in by_amount.values():
        if len(group) < 2:
            continue
        debits = [t for t in group if t.is_debit]
        credits = [t for t in group if not t.is_debit]
        if not debits or not credits:
            continue

        # Greedy: for each debit find the closest credit within window.
        credits_sorted = sorted(credits, key=lambda x: (x.d, x.id))
        for d in sorted(debits, key=lambda x: (x.d, x.id)):
            if d.id in marked:
                continue
            best: _Txn | None = None
            best_delta = 999
            for c in credits_sorted:
                if c.id in marked:
                    continue
                if d.account_iban == c.account_iban:
                    continue
                if {d.account_iban, c.account_iban} != {IBAN_A, IBAN_B}:
                    continue
                delta = abs((d.d - c.d).days)
                if delta <= 3 and delta < best_delta:
                    best = c
                    best_delta = delta
                    if best_delta == 0:
                        break
            if best is not None:
                marked.add(d.id)
                marked.add(best.id)
                pairs += 1

    if not marked:
        return {"updated": 0, "pairs": 0}

    # Mark both sides as internal transfers.
    await db.execute(
        f"UPDATE transactions SET is_internal_transfer = 1 WHERE id IN ({','.join(['?'] * len(marked))})",
        tuple(sorted(marked)),
    )
    await db.commit()
    return {"updated": len(marked), "pairs": pairs}

