"""Cross-sphere correlation analyzer for AIR4.

Finds connections between Finance, Health, Projects, and Life (overload)
that surface on the Overview ``Patterns`` card. Pure-Python (no LLM) so
it runs cheaply on every observation refresh / 24h scheduler tick.

Design notes
------------
* The analyzer is read-only against ``transactions``, ``project_logs``,
  ``workouts``, ``health_checkups``, and ``projects``. Writes go to
  ``cross_sphere_insights`` only.
* Each rule produces at most one insight per run to keep the Patterns
  card readable; the noisiest source (per-project spend correlation)
  caps at the top-3 by effect size.
* Insights are dedup'd against the last 7 days by ``(sphere1, sphere2,
  normalized_title)`` so a slow-changing pattern doesn't accumulate.
* Expiry is 14 days from creation; the GET endpoint filters by
  ``expires_at > now`` so stale insights drop off automatically once
  the underlying signal stops repeating.
* Tone follows CHARACTER_SYSTEM: low confidence → "Похоже, что…",
  medium → "Начинает выглядеть как паттерн", high → "Судя по данным
  за X недель…". The exact phrasing is baked into the per-rule
  builders below so each insight reads naturally instead of being
  prefixed mechanically.
"""

from __future__ import annotations

import json
import logging
import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any, Iterable

from database import execute, fetch_all, fetch_one

logger = logging.getLogger("cross_sphere_analyzer")

# Window the analyzer looks back. 12 weeks balances "enough data to
# see a pattern" against "old enough to be irrelevant".
_LOOKBACK_DAYS = 84  # 12 weeks
_RECENT_DAYS = 30
_DEDUP_WINDOW_DAYS = 7
_INSIGHT_TTL_DAYS = 14

# Effect-size thresholds. Tuned so a single bad week doesn't fire and
# the user actually sees something meaningful (>30% delta).
_SPEND_SPIKE_RATIO = 1.3
_WORKOUT_DROUGHT_DAYS = 5
_PROJECT_STALL_DAYS = 7
_MIN_OVERLOAD_PROJECTS = 3

# Confidence tier boundaries used by the tone helpers below.
_TIER_MED = 0.6
_TIER_HIGH = 0.8


# ----------------------------- helpers ----------------------------- #


def _today() -> date:
    return date.today()


def _parse_date(value: Any) -> date | None:
    """Tolerant date parser — accepts ISO date, ISO datetime, or `None`.
    Used everywhere since both `transactions.date` and `events.date`
    sometimes carry a timestamp suffix and sometimes not."""
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    s = s.replace("T", " ").replace("Z", "")
    # Try ISO date first (most common), then a few fallbacks.
    for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M:%S.%f"):
        try:
            return datetime.strptime(s[: len(fmt) + 4], fmt).date()
        except ValueError:
            continue
    return None


def _iso_week_key(d: date) -> str:
    """Stable bucket key for week-level aggregation (ISO year+week)."""
    iso = d.isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"


def _safe_ratio(a: float, b: float) -> float | None:
    if b <= 0:
        return None
    return a / b


def _pct(n: float) -> int:
    return int(round(n * 100))


def _normalize_title(title: str) -> str:
    """Used by the dedup check. Lowercased, punctuation stripped,
    whitespace collapsed so 'X буксует' and 'X буксует.' collide."""
    s = (title or "").strip().lower()
    s = re.sub(r"[^\w\s]", " ", s, flags=re.UNICODE)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _tier_prefix(confidence: float, weeks_of_data: int | None = None) -> str:
    """Per-spec tone prefix. weeks_of_data is appended on the high
    tier so the user knows the sample size."""
    if confidence < _TIER_MED:
        return "Похоже, что"
    if confidence < _TIER_HIGH:
        return "Начинает выглядеть как паттерн:"
    weeks = weeks_of_data or int(_LOOKBACK_DAYS / 7)
    return f"Судя по данным за {weeks} недель,"


# ----------------------------- data load --------------------------- #


@dataclass
class _AnalyzerData:
    """Single read pass over the DB. Each analyzer rule slices this
    instead of re-querying so a full refresh stays under one round-trip
    per table."""

    transactions: list[dict[str, Any]] = field(default_factory=list)
    project_logs: list[dict[str, Any]] = field(default_factory=list)
    active_projects: list[dict[str, Any]] = field(default_factory=list)
    workouts: list[dict[str, Any]] = field(default_factory=list)
    health_checkups: list[dict[str, Any]] = field(default_factory=list)


def _load_all(db: Any) -> _AnalyzerData:
    start = (_today() - timedelta(days=_LOOKBACK_DAYS)).isoformat()
    data = _AnalyzerData()

    data.transactions = fetch_all(
        db,
        """
        SELECT date, amount, COALESCE(category, 'uncategorized') AS category
        FROM transactions
        WHERE date >= ?
          AND COALESCE(is_debit, 0) = 1
          AND COALESCE(is_internal_transfer, 0) = 0
        """,
        (start,),
    )
    data.project_logs = fetch_all(
        db,
        """
        SELECT project_id, log_type, created_at
        FROM project_logs
        WHERE date(created_at) >= ?
        """,
        (start,),
    )
    data.active_projects = fetch_all(
        db,
        """
        SELECT id, name, status, created_at, updated_at
        FROM projects
        WHERE status IN ('active', 'stalled')
        """,
    )
    data.workouts = fetch_all(
        db,
        "SELECT date FROM workouts WHERE date >= ?",
        (start,),
    )
    data.health_checkups = fetch_all(
        db,
        """
        SELECT date, marker_name, value, status, reference_min, reference_max
        FROM health_checkups
        WHERE date >= ?
        ORDER BY date DESC
        """,
        (start,),
    )
    return data


# ----------------------------- aggregations ------------------------ #


def _weekly_spending(
    transactions: list[dict[str, Any]],
    category_filter: Iterable[str] | None = None,
) -> dict[str, float]:
    out: dict[str, float] = defaultdict(float)
    cats = set(category_filter) if category_filter else None
    for tx in transactions:
        d = _parse_date(tx.get("date"))
        if d is None:
            continue
        category = str(tx.get("category") or "")
        if cats is not None and category not in cats:
            continue
        amount = float(tx.get("amount") or 0)
        if amount <= 0:
            continue
        out[_iso_week_key(d)] += amount
    return dict(out)


def _project_active_weeks(
    project_logs: list[dict[str, Any]], project_id: int
) -> set[str]:
    weeks: set[str] = set()
    for log in project_logs:
        if log.get("project_id") != project_id:
            continue
        d = _parse_date(log.get("created_at"))
        if d is None:
            continue
        weeks.add(_iso_week_key(d))
    return weeks


def _workout_droughts(
    workouts: list[dict[str, Any]], min_gap_days: int
) -> list[tuple[date, date]]:
    """Yields ``(gap_start, gap_end)`` pairs where no workout happened
    for at least ``min_gap_days`` consecutive days inside the lookback
    window. Both endpoints inclusive."""
    if not workouts:
        return []
    dates = sorted({_parse_date(w.get("date")) for w in workouts})
    dates = [d for d in dates if d is not None]
    if not dates:
        return []

    droughts: list[tuple[date, date]] = []
    for i in range(len(dates) - 1):
        prev = dates[i]
        nxt = dates[i + 1]
        gap = (nxt - prev).days - 1
        if gap >= min_gap_days:
            droughts.append((prev + timedelta(days=1), nxt - timedelta(days=1)))
    # Tail drought: from the last workout to today.
    today = _today()
    tail_gap = (today - dates[-1]).days
    if tail_gap >= min_gap_days:
        droughts.append((dates[-1] + timedelta(days=1), today))
    return droughts


def _project_last_activity(
    project_logs: list[dict[str, Any]], project_id: int
) -> date | None:
    latest: date | None = None
    for log in project_logs:
        if log.get("project_id") != project_id:
            continue
        d = _parse_date(log.get("created_at"))
        if d is None:
            continue
        if latest is None or d > latest:
            latest = d
    return latest


def _is_marker_bad(checkup: dict[str, Any]) -> bool:
    """A marker is 'bad' when its status field says so OR when its
    numeric value falls outside the reference range. We accept both
    because status is sometimes ``None`` on chat-imported rows."""
    status = str(checkup.get("status") or "").strip().lower()
    if status in {"high", "low", "abnormal", "bad", "out_of_range"}:
        return True
    try:
        value = float(checkup.get("value"))
    except (TypeError, ValueError):
        return False
    ref_min = checkup.get("reference_min")
    ref_max = checkup.get("reference_max")
    if ref_max is not None and value > float(ref_max):
        return True
    if ref_min is not None and value < float(ref_min):
        return True
    return False


# ----------------------------- rules ------------------------------- #


@dataclass
class _Insight:
    sphere1: str
    sphere2: str
    title: str
    description: str
    confidence: float
    evidence: dict[str, Any]


def _analyze_finance_vs_projects(data: _AnalyzerData) -> list[_Insight]:
    """Per project: compare spending in weeks the project moved vs
    weeks it stalled. A 30%+ spike in stall weeks is the signal."""
    if not data.active_projects or not data.transactions:
        return []

    weekly_total = _weekly_spending(data.transactions)
    if len(weekly_total) < 4:
        return []  # need at least 4 weeks of finance data

    insights: list[_Insight] = []
    for project in data.active_projects:
        project_id = int(project["id"])
        active_weeks = _project_active_weeks(data.project_logs, project_id)
        if not active_weeks:
            continue
        stall_weeks = set(weekly_total.keys()) - active_weeks
        if len(stall_weeks) < 2 or len(active_weeks) < 2:
            continue

        active_avg = sum(weekly_total[w] for w in active_weeks) / max(
            1, len(active_weeks)
        )
        stall_avg = sum(weekly_total[w] for w in stall_weeks) / max(
            1, len(stall_weeks)
        )
        if active_avg <= 0:
            continue
        ratio = stall_avg / active_avg
        if ratio < _SPEND_SPIKE_RATIO:
            continue

        delta_pct = _pct(ratio - 1)
        weeks_sample = len(weekly_total)
        # Confidence ramps with sample size and effect magnitude;
        # capped at 0.9 because we're correlating, not causing.
        confidence = min(
            0.9,
            0.35
            + min(0.25, (ratio - _SPEND_SPIKE_RATIO) * 0.5)
            + min(0.3, weeks_sample / 24),
        )
        weeks_of_data = max(4, len(weekly_total))
        prefix = _tier_prefix(confidence, weeks_of_data)
        title = f"Траты ↑ когда «{project['name']}» буксует"
        description = (
            f"{prefix} траты в недели без активности по «{project['name']}» "
            f"в среднем на {delta_pct}% выше, чем в недели с фокус-сессиями "
            f"(€{stall_avg:.0f}/нед vs €{active_avg:.0f}/нед, выборка "
            f"{weeks_sample} нед)."
        )
        insights.append(
            _Insight(
                sphere1="finance",
                sphere2="projects",
                title=title,
                description=description,
                confidence=round(confidence, 2),
                evidence={
                    "project_id": project_id,
                    "project_name": project["name"],
                    "active_weeks": len(active_weeks),
                    "stall_weeks": len(stall_weeks),
                    "active_avg_eur": round(active_avg, 2),
                    "stall_avg_eur": round(stall_avg, 2),
                    "delta_pct": delta_pct,
                    "weeks_sample": weeks_sample,
                },
            )
        )

    # Top 3 by effect size keeps the Patterns card readable when
    # several projects light up at once.
    insights.sort(key=lambda i: i.evidence.get("delta_pct", 0), reverse=True)
    return insights[:3]


def _analyze_health_vs_projects(data: _AnalyzerData) -> list[_Insight]:
    """Workout droughts that overlap project stalls of the same shape."""
    if not data.workouts or not data.active_projects:
        return []
    droughts = _workout_droughts(data.workouts, _WORKOUT_DROUGHT_DAYS)
    if not droughts:
        return []

    today = _today()
    affected: list[dict[str, Any]] = []
    for project in data.active_projects:
        last = _project_last_activity(data.project_logs, int(project["id"]))
        if last is None:
            continue
        days_since = (today - last).days
        if days_since < _PROJECT_STALL_DAYS:
            continue
        # Does the project's stall window overlap any drought?
        stall_start = last + timedelta(days=1)
        for gap_start, gap_end in droughts:
            overlap_start = max(stall_start, gap_start)
            overlap_end = min(today, gap_end)
            if overlap_start <= overlap_end:
                affected.append(
                    {
                        "project_name": project["name"],
                        "days_stalled": days_since,
                        "overlap_days": (overlap_end - overlap_start).days + 1,
                    }
                )
                break

    if not affected:
        return []

    drought_days = max((d2 - d1).days + 1 for d1, d2 in droughts)
    # Confidence scales with how many projects are affected and how
    # long the drought has run.
    confidence = min(0.85, 0.4 + 0.1 * len(affected) + min(0.25, drought_days / 30))
    prefix = _tier_prefix(confidence)
    names = ", ".join(f"«{a['project_name']}»" for a in affected)
    description = (
        f"{prefix} {drought_days}-дневный пропуск тренировок совпадает с "
        f"замедлением: {names}. Часто тело и работа замолкают одновременно."
    )
    return [
        _Insight(
            sphere1="health",
            sphere2="projects",
            title="Тренировок нет — проекты замолкают",
            description=description,
            confidence=round(confidence, 2),
            evidence={
                "drought_days": drought_days,
                "affected_projects": affected,
                "drought_count": len(droughts),
            },
        )
    ]


def _analyze_finance_vs_health(data: _AnalyzerData) -> list[_Insight]:
    """Restaurants spending in 30-day windows around bad health markers."""
    if not data.health_checkups or not data.transactions:
        return []

    # Find dates with at least one bad marker.
    bad_dates: set[date] = set()
    bad_markers: list[str] = []
    for c in data.health_checkups:
        d = _parse_date(c.get("date"))
        if d is None or not _is_marker_bad(c):
            continue
        bad_dates.add(d)
        marker = str(c.get("marker_name") or "").strip()
        if marker and marker not in bad_markers:
            bad_markers.append(marker)
    if not bad_dates:
        return []

    # Restaurant spending in the 30 days *before* each bad-marker date.
    bad_window_total = 0.0
    bad_window_days: set[date] = set()
    for tx in data.transactions:
        if str(tx.get("category") or "") != "food_restaurants":
            continue
        d = _parse_date(tx.get("date"))
        if d is None:
            continue
        for bd in bad_dates:
            if 0 <= (bd - d).days <= _RECENT_DAYS:
                bad_window_total += float(tx.get("amount") or 0)
                bad_window_days.add(d)
                break

    # Baseline: restaurant spending outside any bad window.
    baseline_total = 0.0
    baseline_days: set[date] = set()
    for tx in data.transactions:
        if str(tx.get("category") or "") != "food_restaurants":
            continue
        d = _parse_date(tx.get("date"))
        if d is None or d in bad_window_days:
            continue
        baseline_total += float(tx.get("amount") or 0)
        baseline_days.add(d)

    # A single transaction day vs 30 baseline days produces wildly
    # unstable averages. Require at least 3 spending days inside the
    # bad-marker window and 7 outside before the rule fires.
    if len(bad_window_days) < 3 or len(baseline_days) < 7:
        return []

    bad_avg = bad_window_total / len(bad_window_days)
    base_avg = baseline_total / len(baseline_days)
    if base_avg <= 0:
        return []
    ratio = bad_avg / base_avg
    if ratio < _SPEND_SPIKE_RATIO:
        return []

    delta_pct = _pct(ratio - 1)
    confidence = min(
        0.85, 0.35 + min(0.25, (ratio - _SPEND_SPIKE_RATIO) * 0.5) + min(0.25, len(bad_markers) / 5)
    )
    prefix = _tier_prefix(confidence)
    marker_list = ", ".join(bad_markers[:3])
    if len(bad_markers) > 3:
        marker_list += f" и ещё {len(bad_markers) - 3}"
    description = (
        f"{prefix} в недели перед плохими маркерами ({marker_list}) "
        f"рестораны в среднем на {delta_pct}% выше — €{bad_avg:.0f}/день "
        f"против €{base_avg:.0f}/день в нормальные периоды."
    )
    return [
        _Insight(
            sphere1="finance",
            sphere2="health",
            title="Рестораны ↑ когда здоровье ↓",
            description=description,
            confidence=round(confidence, 2),
            evidence={
                "bad_markers": bad_markers,
                "bad_window_avg_eur": round(bad_avg, 2),
                "baseline_avg_eur": round(base_avg, 2),
                "delta_pct": delta_pct,
                "bad_window_days": len(bad_window_days),
            },
        )
    ]


def _analyze_projects_overload(data: _AnalyzerData) -> list[_Insight]:
    """3+ active projects stalled at the same time → likely overload."""
    if len(data.active_projects) < _MIN_OVERLOAD_PROJECTS:
        return []
    today = _today()
    stalled: list[dict[str, Any]] = []
    for project in data.active_projects:
        last = _project_last_activity(data.project_logs, int(project["id"]))
        if last is None:
            # Fall back to projects.updated_at — a brand-new project
            # without logs is not yet stalled.
            last = _parse_date(project.get("updated_at"))
        if last is None:
            continue
        days = (today - last).days
        if days >= _PROJECT_STALL_DAYS:
            stalled.append(
                {
                    "project_id": int(project["id"]),
                    "project_name": project["name"],
                    "days_stalled": days,
                }
            )

    if len(stalled) < _MIN_OVERLOAD_PROJECTS:
        return []

    # Confidence climbs with how many projects are stalled and for
    # how long. Capped at 0.85 (we're not a doctor).
    avg_days = sum(s["days_stalled"] for s in stalled) / len(stalled)
    confidence = min(
        0.85, 0.45 + 0.07 * (len(stalled) - _MIN_OVERLOAD_PROJECTS + 1) + min(0.25, avg_days / 30)
    )
    prefix = _tier_prefix(confidence)
    names = ", ".join(f"«{s['project_name']}»" for s in stalled[:4])
    if len(stalled) > 4:
        names += f" и ещё {len(stalled) - 4}"
    description = (
        f"{prefix} {len(stalled)} активных проекта застряли одновременно "
        f"({names}). Средний возраст молчания — {int(avg_days)} дней. "
        "Возможно, перегрузка или потеря фокуса."
    )
    return [
        _Insight(
            sphere1="projects",
            sphere2="life",
            title=f"{len(stalled)} проекта молчат одновременно",
            description=description,
            confidence=round(confidence, 2),
            evidence={
                "stalled_projects": stalled,
                "avg_days_stalled": round(avg_days, 1),
            },
        )
    ]


# ----------------------------- persistence ------------------------- #


def _is_duplicate(db: Any, insight: _Insight) -> bool:
    """True if the same (sphere1, sphere2, normalized title) was
    saved in the last 7 days. Cheap natural-key dedup that doesn't
    require a separate index."""
    rows = fetch_all(
        db,
        """
        SELECT title
        FROM cross_sphere_insights
        WHERE sphere1 = ?
          AND sphere2 = ?
          AND datetime(created_at) >= datetime('now', ?)
        """,
        (
            insight.sphere1,
            insight.sphere2,
            f"-{_DEDUP_WINDOW_DAYS} days",
        ),
    )
    target = _normalize_title(insight.title)
    for row in rows:
        if _normalize_title(str(row.get("title") or "")) == target:
            return True
    return False


def _save_insight(db: Any, insight: _Insight) -> int | None:
    if _is_duplicate(db, insight):
        logger.info(
            "cross_sphere: dedup skip %s ↔ %s '%s'",
            insight.sphere1,
            insight.sphere2,
            insight.title,
        )
        return None
    try:
        new_id = execute(
            db,
            """
            INSERT INTO cross_sphere_insights (
                sphere1, sphere2, title, description, confidence,
                evidence, is_active, expires_at, created_at
            )
            VALUES (
                ?, ?, ?, ?, ?,
                ?, 1, datetime('now', ?), datetime('now')
            )
            """,
            (
                insight.sphere1,
                insight.sphere2,
                insight.title,
                insight.description,
                insight.confidence,
                json.dumps(insight.evidence, ensure_ascii=False),
                f"+{_INSIGHT_TTL_DAYS} days",
            ),
        )
        return int(new_id)
    except Exception:
        logger.exception("cross_sphere: failed to insert insight %s", insight.title)
        return None


def _retire_stale(db: Any) -> int:
    """Soft-delete insights whose evidence has aged out. Returns the
    number of rows flipped to ``is_active=0``. Lets the GET endpoint
    stay a single index-friendly filter."""
    try:
        # We can't use the `execute` helper here because we need the
        # rowcount, which the wrapper doesn't surface.
        cursor = db.execute(
            """
            UPDATE cross_sphere_insights
               SET is_active = 0
             WHERE is_active = 1
               AND expires_at IS NOT NULL
               AND datetime(expires_at) < datetime('now')
            """
        )
        return int(cursor.rowcount or 0)
    except Exception:
        logger.exception("cross_sphere: failed to retire stale insights")
        return 0


# ----------------------------- entry point ------------------------- #


def run_cross_sphere_analysis(db: Any) -> dict[str, Any]:
    """Run all rules, persist surviving insights, retire stale ones.

    Returns a small report dict so callers (observation scheduler,
    /observations/generate) can log or surface what was found.
    """
    retired = _retire_stale(db)
    try:
        data = _load_all(db)
    except Exception:
        logger.exception("cross_sphere: data load failed")
        return {"saved": 0, "candidates": 0, "retired": retired, "error": "load"}

    candidates: list[_Insight] = []
    for rule in (
        _analyze_finance_vs_projects,
        _analyze_health_vs_projects,
        _analyze_finance_vs_health,
        _analyze_projects_overload,
    ):
        try:
            candidates.extend(rule(data))
        except Exception:
            logger.exception("cross_sphere: rule %s failed", rule.__name__)

    saved_ids: list[int] = []
    for insight in candidates:
        new_id = _save_insight(db, insight)
        if new_id is not None:
            saved_ids.append(new_id)

    logger.info(
        "cross_sphere: candidates=%d saved=%d retired=%d",
        len(candidates),
        len(saved_ids),
        retired,
    )
    return {
        "saved": len(saved_ids),
        "candidates": len(candidates),
        "retired": retired,
        "ids": saved_ids,
    }


def fetch_active_insights(db: Any, limit: int = 20) -> list[dict[str, Any]]:
    """Active = ``is_active=1`` AND not expired. Newest + highest-
    confidence first so the FE can ``slice(0, N)`` without sorting."""
    rows = fetch_all(
        db,
        """
        SELECT id, sphere1, sphere2, title, description, confidence,
               evidence, is_active, expires_at, created_at
        FROM cross_sphere_insights
        WHERE is_active = 1
          AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
        ORDER BY confidence DESC, datetime(created_at) DESC, id DESC
        LIMIT ?
        """,
        (limit,),
    )
    out: list[dict[str, Any]] = []
    for row in rows:
        evidence_raw = row.get("evidence")
        evidence: Any
        if evidence_raw is None or evidence_raw == "":
            evidence = None
        else:
            try:
                evidence = json.loads(str(evidence_raw))
            except (TypeError, ValueError, json.JSONDecodeError):
                evidence = None
        out.append(
            {
                "id": int(row["id"]),
                "sphere1": str(row["sphere1"]),
                "sphere2": str(row["sphere2"]),
                "title": str(row["title"]),
                "description": str(row["description"]),
                "confidence": float(row.get("confidence") or 0),
                "evidence": evidence,
                "is_active": bool(row.get("is_active")),
                "expires_at": row.get("expires_at"),
                "created_at": row.get("created_at"),
            }
        )
    return out

