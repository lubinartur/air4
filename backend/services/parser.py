from __future__ import annotations

import csv
import re
import sqlite3
from dataclasses import dataclass
from datetime import date, datetime
from typing import Iterable

from database import fetch_all, fetch_one

_CARD_GARBAGE_RE = re.compile(
    r"^'?(\d{6})\*+(\d{4})\s+(\d{2}\.\d{2}\.\d{2})\s+(?P<merchant>.+)$"
)

_SERVICE_ROW_PREFIXES_CF: tuple[str, ...] = ("lõppsaldo", "käive", "algsaldo")

_OWNER_COUNTERPARTY = "ARTUR LUBIN"
_OWN_ACCOUNTS_DESC = "transfer between own accounts"
_CREDIT_REPAYMENT_DESC = "credit repayment"
_SISSEMAKSE_DESC = "sissemakse"

# Owner accounts — extended when new statement IBANs are uploaded.
KNOWN_IBANS: list[str] = [
    "EE922200221039353138",
    "EE982200221067340731",
]


def register_known_ibans(ibans: Iterable[str]) -> None:
    """Add IBANs discovered from uploads (deduplicated, case-insensitive)."""
    existing = {iban.casefold() for iban in KNOWN_IBANS}
    for raw in ibans:
        iban = (raw or "").strip()
        if not iban:
            continue
        key = iban.casefold()
        if key not in existing:
            KNOWN_IBANS.append(iban)
            existing.add(key)


def known_ibans_set() -> set[str]:
    return {iban.casefold() for iban in KNOWN_IBANS}


def primary_iban_from_transactions(transactions: Iterable[TransactionIn]) -> str | None:
    counts: dict[str, int] = {}
    for txn in transactions:
        iban = (txn.account_iban or "").strip()
        if iban:
            counts[iban] = counts.get(iban, 0) + 1
    if not counts:
        return None
    return max(counts.items(), key=lambda item: item[1])[0]


@dataclass
class TransactionIn:
    date: date
    description: str
    raw_description: str
    amount: float
    currency: str = "EUR"
    is_debit: bool = True
    account_iban: str = ""
    counterparty: str = ""
    is_internal_transfer: bool = False


def _parse_date_ddmmyyyy(value: str) -> date:
    return datetime.strptime(value.strip(), "%d.%m.%Y").date()


def _parse_amount(value: str) -> float:
    v = (value or "").strip().replace(" ", "").replace(",", ".")
    try:
        return abs(float(v))
    except ValueError:
        return 0.0


def _normalize_text(value: str) -> str:
    return " ".join((value or "").casefold().split())


def _text_contains(haystack: str, needle: str) -> bool:
    return _normalize_text(needle) in _normalize_text(haystack)


def _clean_description(selgitus: str) -> str:
    s = (selgitus or "").strip()
    match = _CARD_GARBAGE_RE.match(s)
    if match:
        s = match.group("merchant").strip()
    s = s.lstrip("'").strip()
    return s


def _resolve_description(cleaned_selgitus: str, counterparty: str) -> str:
    desc = cleaned_selgitus.lstrip("'").strip()
    if desc in ("", "."):
        return counterparty.strip() or desc
    return desc


def is_balance_or_service_description(cleaned_description: str) -> bool:
    d = (cleaned_description or "").strip().casefold()
    return any(d.startswith(p) for p in _SERVICE_ROW_PREFIXES_CF)


def parse_swedbank_csv(content: bytes) -> list[TransactionIn]:
    text = content.decode("utf-8-sig")
    reader = csv.DictReader(text.splitlines(), delimiter=";", quotechar='"')

    txns: list[TransactionIn] = []
    for row in reader:
        if not row:
            continue
        norm = {str(k).strip().casefold(): v for k, v in row.items() if k is not None}

        def get(key: str) -> str:
            return str(norm.get(key.casefold(), "") or "")

        if get("Reatüüp").strip() == "10":
            continue

        account_iban = get("Kliendi konto").strip()
        dt = _parse_date_ddmmyyyy(get("Kuupäev"))
        counterparty = get("Saaja/Maksja").strip()
        raw_desc = get("Selgitus")
        cleaned = _clean_description(raw_desc)
        if is_balance_or_service_description(cleaned):
            continue

        desc = _resolve_description(cleaned, counterparty)
        amount = _parse_amount(get("Summa") or "0")
        currency = (get("Valuuta") or "EUR").strip() or "EUR"
        dk = (get("Deebet/Kreedit") or "").strip().upper()
        is_debit = dk == "D"

        txns.append(
            TransactionIn(
                date=dt,
                description=desc,
                raw_description=raw_desc,
                amount=amount,
                currency=currency,
                is_debit=is_debit,
                account_iban=account_iban,
                counterparty=counterparty,
            )
        )

    return txns


def _mark_rule_based(transactions: list[TransactionIn]) -> None:
    owner_norm = _normalize_text(_OWNER_COUNTERPARTY)
    known = known_ibans_set()
    for txn in transactions:
        raw = txn.raw_description or ""
        desc = txn.description or ""
        combined = f"{raw} {desc}"
        counterparty = (txn.counterparty or "").strip()
        cp_norm = _normalize_text(counterparty)
        account = (txn.account_iban or "").strip().casefold()

        if _text_contains(combined, _OWN_ACCOUNTS_DESC):
            txn.is_internal_transfer = True
            continue

        if _text_contains(combined, _CREDIT_REPAYMENT_DESC):
            txn.is_internal_transfer = True
            continue

        if cp_norm == owner_norm or _text_contains(combined, _OWNER_COUNTERPARTY):
            txn.is_internal_transfer = True
            continue

        if not counterparty and _text_contains(raw, _SISSEMAKSE_DESC):
            txn.is_internal_transfer = True
            continue

        if account in known:
            for other_iban in known:
                if other_iban != account and other_iban.upper() in combined.upper():
                    txn.is_internal_transfer = True
                    break


def mark_internal_transfers(
    transactions: list[TransactionIn],
    *,
    owner_name: str | None = None,
    known_ibans: Iterable[str] | None = None,
) -> None:
    """Mark internal transfers from Selgitus / counterparty rules (per file)."""
    del owner_name
    if known_ibans:
        register_known_ibans(known_ibans)
    _mark_rule_based(transactions)


_PAIR_AMOUNT_EPS = 0.01
_PAIR_MAX_DAY_GAP = 2


def _owner_ibans() -> list[str]:
    return [iban for iban in KNOWN_IBANS if iban.strip()]


def _apply_rule_based_sql(conn: sqlite3.Connection, ibans: list[str]) -> None:
    if not ibans:
        return
    placeholders = ",".join("?" * len(ibans))
    conn.execute(
        f"""
        UPDATE transactions
        SET is_internal_transfer = 1
        WHERE COALESCE(is_internal_transfer, 0) = 0
          AND account_iban IN ({placeholders})
          AND (
            LOWER(COALESCE(raw_description, '')) LIKE '%transfer between own accounts%'
            OR LOWER(COALESCE(description, '')) LIKE '%transfer between own accounts%'
            OR LOWER(COALESCE(raw_description, '')) LIKE '%credit repayment%'
            OR LOWER(COALESCE(description, '')) LIKE '%credit repayment%'
            OR LOWER(COALESCE(description, '')) LIKE '%artur lubin%'
            OR LOWER(COALESCE(raw_description, '')) LIKE '%artur lubin%'
          )
        """,
        ibans,
    )
    for iban in ibans:
        for other in ibans:
            if other.casefold() == iban.casefold():
                continue
            needle = other.upper()
            conn.execute(
                f"""
                UPDATE transactions
                SET is_internal_transfer = 1
                WHERE COALESCE(is_internal_transfer, 0) = 0
                  AND account_iban = ?
                  AND (
                    INSTR(UPPER(COALESCE(description, '')), ?) > 0
                    OR INSTR(UPPER(COALESCE(raw_description, '')), ?) > 0
                  )
                """,
                (iban, needle, needle),
            )


def _pair_match_ids(conn: sqlite3.Connection, ibans: list[str]) -> set[int]:
    """Debit on one owner account + credit on the other, same amount, dates within ±2 days."""
    if len(ibans) < 2:
        return set()

    placeholders = ",".join("?" * len(ibans))
    rows = fetch_all(
        conn,
        f"""
        SELECT id, date, amount, is_debit, account_iban
        FROM transactions
        WHERE account_iban IN ({placeholders})
          AND COALESCE(is_internal_transfer, 0) = 0
        ORDER BY date ASC, id ASC
        """,
        ibans,
    )

    iban_set = {b.casefold() for b in ibans}

    @dataclass
    class _Row:
        id: int
        d: date
        amount: float
        is_debit: bool
        account: str

    txns: list[_Row] = []
    for row in rows:
        raw_date = row.get("date")
        if not raw_date:
            continue
        try:
            d = date.fromisoformat(str(raw_date)[:10])
        except ValueError:
            continue
        txns.append(
            _Row(
                id=int(row["id"]),
                d=d,
                amount=float(row["amount"] or 0.0),
                is_debit=bool(row.get("is_debit")),
                account=str(row.get("account_iban") or "").casefold(),
            )
        )

    by_amount: dict[int, list[_Row]] = {}
    for t in txns:
        key = int(round(t.amount * 100))
        by_amount.setdefault(key, []).append(t)

    marked: set[int] = set()
    for group in by_amount.values():
        debits = [t for t in group if t.is_debit]
        credits = [t for t in group if not t.is_debit]
        if not debits or not credits:
            continue

        credits_sorted = sorted(credits, key=lambda x: (x.d, x.id))
        for debit in sorted(debits, key=lambda x: (x.d, x.id)):
            if debit.id in marked:
                continue
            best: _Row | None = None
            best_gap = _PAIR_MAX_DAY_GAP + 1
            for credit in credits_sorted:
                if credit.id in marked:
                    continue
                if debit.account == credit.account:
                    continue
                if debit.account not in iban_set or credit.account not in iban_set:
                    continue
                gap = abs((debit.d - credit.d).days)
                if gap <= _PAIR_MAX_DAY_GAP and gap < best_gap:
                    if abs(debit.amount - credit.amount) >= _PAIR_AMOUNT_EPS:
                        continue
                    best = credit
                    best_gap = gap
                    if best_gap == 0:
                        break
            if best is not None:
                marked.add(debit.id)
                marked.add(best.id)

    return marked


def _mark_text_pattern_transfers(conn: sqlite3.Connection) -> None:
    """Catch internal transfers identified by literal description phrases.

    Used to live in `summary_loader._refresh_internal_flags` and ran on
    every summary read; moved here so all transfer-marking happens once at
    upload time. The patterns match Swedbank's exported descriptions for
    self-transfers and credit-card repayments that the structural rules
    might miss (no counterparty IBAN, no paired D/K row).
    """
    conn.execute(
        """
        UPDATE transactions
        SET is_internal_transfer = 1
        WHERE COALESCE(is_internal_transfer, 0) = 0
          AND (
            LOWER(COALESCE(raw_description, '')) LIKE '%transfer between own accounts%'
            OR LOWER(COALESCE(description, '')) LIKE '%transfer between own accounts%'
            OR LOWER(COALESCE(raw_description, '')) LIKE '%credit repayment%'
            OR LOWER(COALESCE(description, '')) LIKE '%credit repayment%'
          )
        """
    )


def mark_internal_transfers_in_db(conn: sqlite3.Connection) -> int:
    """
    Mark internal transfers between the user's own Swedbank accounts in SQLite.
    Rules: description patterns, counterparty IBAN in text, paired D/K within ±2 days,
    plus a literal text-phrase fallback for legacy / structurally-ambiguous rows.

    Intended to run once at upload time; readers query the persisted
    `is_internal_transfer` flag.
    """
    sync_known_ibans_from_db(conn)
    ibans = _owner_ibans()
    if not ibans:
        # No owner IBANs known yet — text-phrase fallback is still safe.
        before = fetch_one(
            conn,
            "SELECT COUNT(*) AS c FROM transactions WHERE is_internal_transfer = 1",
        )
        before_count = int((before or {}).get("c") or 0)
        _mark_text_pattern_transfers(conn)
        conn.commit()
        after = fetch_one(
            conn,
            "SELECT COUNT(*) AS c FROM transactions WHERE is_internal_transfer = 1",
        )
        return int((after or {}).get("c") or 0) - before_count

    before = fetch_one(
        conn,
        "SELECT COUNT(*) AS c FROM transactions WHERE is_internal_transfer = 1",
    )
    before_count = int((before or {}).get("c") or 0)

    _apply_rule_based_sql(conn, ibans)
    pair_ids = _pair_match_ids(conn, ibans)
    if pair_ids:
        marks = ",".join("?" * len(pair_ids))
        conn.execute(
            f"UPDATE transactions SET is_internal_transfer = 1 WHERE id IN ({marks})",
            sorted(pair_ids),
        )
    _mark_text_pattern_transfers(conn)
    conn.commit()

    after = fetch_one(
        conn,
        "SELECT COUNT(*) AS c FROM transactions WHERE is_internal_transfer = 1",
    )
    return int((after or {}).get("c") or 0) - before_count


def sync_known_ibans_from_db(conn: sqlite3.Connection) -> None:
    rows = fetch_all(
        conn,
        """
        SELECT DISTINCT account_iban
        FROM uploads
        WHERE account_iban IS NOT NULL AND TRIM(account_iban) != ''
        """,
    )
    register_known_ibans(str(row["account_iban"]) for row in rows)
    txn_rows = fetch_all(
        conn,
        """
        SELECT DISTINCT account_iban
        FROM transactions
        WHERE account_iban IS NOT NULL AND TRIM(account_iban) != ''
        """,
    )
    register_known_ibans(str(row["account_iban"]) for row in txn_rows)


def period_range(
    transactions: Iterable[TransactionIn],
) -> tuple[str | None, str | None]:
    dates = [t.date for t in transactions]
    if not dates:
        return None, None
    return min(dates).isoformat(), max(dates).isoformat()
