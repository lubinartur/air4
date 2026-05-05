from __future__ import annotations

import csv
import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from typing import Iterable

from app.models.transaction import TransactionIn


_CARD_GARBAGE_RE = re.compile(
    r"^'?(\d{6})\*+(\d{4})\s+(\d{2}\.\d{2}\.\d{2})\s+(?P<merchant>.+)$"
)


def _parse_date_ddmmyyyy(v: str) -> date:
    return datetime.strptime(v.strip(), "%d.%m.%Y").date()


def _parse_amount(v: str) -> float:
    v = (v or "").strip().replace(" ", "")
    v = v.replace(",", ".")
    try:
        return abs(float(v))
    except ValueError:
        return 0.0


def _clean_description(selgitus: str) -> str:
    s = (selgitus or "").strip()
    m = _CARD_GARBAGE_RE.match(s)
    if m:
        return m.group("merchant").strip()
    return s


# Case-insensitive prefix match on cleaned description (Estonian balance / service lines).
_SERVICE_ROW_PREFIXES_CF: tuple[str, ...] = ("lõppsaldo", "käive", "algsaldo")


def is_balance_or_service_description(cleaned_description: str) -> bool:
    d = (cleaned_description or "").strip().casefold()
    return any(d.startswith(p) for p in _SERVICE_ROW_PREFIXES_CF)


def parse_swedbank_csv(content: bytes) -> list[TransactionIn]:
    text = content.decode("utf-8-sig")
    reader = csv.DictReader(
        text.splitlines(),
        delimiter=";",
        quotechar='"',
    )

    txns: list[TransactionIn] = []
    for row in reader:
        if not row:
            continue
        norm = {str(k).strip().casefold(): v for k, v in row.items() if k is not None}

        def get(key: str) -> str:
            return str(norm.get(key.casefold(), "") or "")

        row_type = get("Reatüüp").strip()
        if row_type == "10":
            continue

        account_iban = get("Kliendi konto").strip()
        dt = _parse_date_ddmmyyyy(get("Kuupäev"))
        raw_desc = get("Selgitus")
        desc = _clean_description(raw_desc)
        if is_balance_or_service_description(desc):
            continue
        amount = _parse_amount(get("Summa") or "0")
        currency = (get("Valuuta") or "EUR").strip() or "EUR"
        dk = (get("Deebet/Kreedit") or "").strip().upper()
        is_debit = True if dk == "D" else False

        txns.append(
            TransactionIn(
                date=dt,
                description=desc,
                raw_description=raw_desc,
                amount=amount,
                currency=currency,
                is_debit=is_debit,
                account_iban=account_iban,
            )
        )

    return txns


@dataclass(frozen=True)
class _IndexTxn:
    idx: int
    date: date
    amount_key: int
    is_debit: bool
    account_iban: str


def mark_internal_transfers(transactions: list[TransactionIn]) -> None:
    """
    Internal transfer detection (after parsing both files):
    - same amount
    - date within 1 day
    - one debit, one credit
    - different account_iban
    Marks both sides as internal transfers.
    """
    by_amount: dict[int, list[_IndexTxn]] = defaultdict(list)
    for i, t in enumerate(transactions):
        amount_key = int(round(t.amount * 100))
        by_amount[amount_key].append(
            _IndexTxn(
                idx=i,
                date=t.date,
                amount_key=amount_key,
                is_debit=t.is_debit,
                account_iban=t.account_iban,
            )
        )

    marked: set[int] = set()
    for group in by_amount.values():
        if len(group) < 2:
            continue
        debits = [g for g in group if g.is_debit]
        credits = [g for g in group if not g.is_debit]
        if not debits or not credits:
            continue

        for d in debits:
            if d.idx in marked:
                continue
            best: _IndexTxn | None = None
            for c in credits:
                if c.idx in marked:
                    continue
                if d.account_iban == c.account_iban:
                    continue
                if abs((d.date - c.date).days) <= 1:
                    best = c
                    break
            if best is not None:
                marked.add(d.idx)
                marked.add(best.idx)

    for idx in marked:
        transactions[idx].is_internal_transfer = True


def period_range(transactions: Iterable[TransactionIn]) -> tuple[str | None, str | None]:
    dates = [t.date for t in transactions]
    if not dates:
        return None, None
    return min(dates).isoformat(), max(dates).isoformat()
