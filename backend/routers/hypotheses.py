from __future__ import annotations

import json

from fastapi import APIRouter

from database import fetch_all, get_db
from schemas import HypothesisOut, HypothesesListOut

router = APIRouter()

_LIMIT = 20


def _parse_domains(raw: object | None) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return [str(x).strip() for x in raw if str(x).strip()]
    if isinstance(raw, str):
        s = raw.strip()
        if not s:
            return []
        try:
            parsed = json.loads(s)
            if isinstance(parsed, list):
                return [str(x).strip() for x in parsed if str(x).strip()]
        except json.JSONDecodeError:
            return [p.strip() for p in s.split(",") if p.strip()]
    return []


@router.get("/hypotheses", response_model=HypothesesListOut)
def list_hypotheses() -> HypothesesListOut:
    with get_db() as conn:
        rows = fetch_all(
            conn,
            """
            SELECT
                id, text, status, confidence, evidence_count, domains, created_at
            FROM hypotheses
            ORDER BY datetime(created_at) DESC, id DESC
            LIMIT ?
            """,
            (_LIMIT,),
        )

    hypotheses: list[HypothesisOut] = []
    for row in rows:
        try:
            confidence = float(row.get("confidence") or 0.5)
        except (TypeError, ValueError):
            confidence = 0.5
        try:
            evidence_count = int(row.get("evidence_count") or 1)
        except (TypeError, ValueError):
            evidence_count = 1

        hypotheses.append(
            HypothesisOut(
                id=int(row["id"]),
                text=str(row.get("text") or ""),
                status=str(row.get("status") or "pending"),
                confidence=max(0.0, min(1.0, confidence)),
                evidence_count=max(0, evidence_count),
                domains=_parse_domains(row.get("domains")),
                created_at=row.get("created_at"),
            )
        )

    return HypothesesListOut(hypotheses=hypotheses)
