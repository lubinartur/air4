"""Universal chat action layer — LLM detects intent, user confirms, we execute."""

from __future__ import annotations

import json
import logging
import traceback
from datetime import date
from typing import Any

from database import execute, fetch_all, fetch_one
from services.llm_client import parse_json_object
from services.llm_client_shared import DEFAULT_MODEL, call_claude
from services.subscription_updater import apply_pending_recurring_action
from services.workout_extractor import _normalize_workout, _save_workout

logger = logging.getLogger("action_layer")

SUPPORTED_ACTION_TYPES = frozenset({
    "delete_subscription",
    "restore_subscription",
    "update_subscription",
    "create_subscription",
    "delete_obligation",
    "restore_obligation",
    "update_obligation",
    "create_obligation",
    "log_workout",
    "log_weight",
    "log_project_activity",
    "create_open_loop",
    "resolve_open_loop",
    "set_reminder",
    "no_action",
})

_FINANCE_ACTION_TYPES = frozenset({
    "delete_subscription",
    "restore_subscription",
    "update_subscription",
    "create_subscription",
    "delete_obligation",
    "restore_obligation",
    "update_obligation",
    "create_obligation",
})


def build_action_detection_prompt(
    *,
    user_message: str,
    assistant_response: str,
    subscriptions: list[dict[str, Any]],
    obligations: list[dict[str, Any]],
    projects: list[dict[str, Any]],
    open_loops: list[dict[str, Any]],
) -> str:
    subs_json = json.dumps(subscriptions, ensure_ascii=False)
    obls_json = json.dumps(obligations, ensure_ascii=False)
    projects_json = json.dumps(projects, ensure_ascii=False)
    loops_json = json.dumps(open_loops, ensure_ascii=False)
    return f"""You are an action detector for AIR4.

Given this conversation, determine if the user wants to perform a concrete
action on their data. Use ONLY ids from the lists below — never invent ids.

User message: {user_message}
Assistant response: {assistant_response}
Available subscriptions: {subs_json}
Available obligations: {obls_json}
Available projects: {projects_json}
Open loops: {loops_json}

Return JSON only. No markdown. No explanation.

If action detected:
{{
  "type": "delete_subscription",
  "description": "Удалить Netflix (€16.00/мес)",
  "confidence": 0.85,
  "data": {{"id": 1, "kind": "subscription", "name": "Netflix", "amount": 16.0}}
}}

If no action needed:
{{"type": "no_action"}}

Action types:
delete_subscription, restore_subscription, update_subscription, create_subscription,
delete_obligation, restore_obligation, update_obligation, create_obligation,
log_workout, log_weight, log_project_activity, create_open_loop,
resolve_open_loop, set_reminder

Rules:
- restore_* only for inactive rows (is_active=0). delete_* only for active rows.
- create_subscription only when the name is NOT already in subscriptions.
- create_obligation only when the name is NOT already in obligations.
- update_subscription: data must include id, field (amount|name), value.
- update_obligation: data must include id; pass any of total_amount,
  remaining_amount, monthly_payment, interest_rate, due_date, name, category
  (all provided fields are updated together).
- create_obligation: name, monthly_payment; optional total_amount, remaining_amount,
  due_date (ISO date), category (loan|tech|rent|other).
- create_subscription: name, amount; optional currency (default EUR), billing_day.
- log_workout: date, type, duration (minutes), optional exercises, notes.
- log_weight: date, weight (kg).
- log_project_activity: project_id, note, log_type (update|session|milestone).
- create_open_loop: topic, domain, priority (low|medium|high).
- resolve_open_loop: id from open loops list.
- set_reminder: text, datetime (ISO).
- Prefer the user's explicit intent over the assistant's claims.
- If the user is only discussing or asking, return no_action.

Examples:

User: "добавь Netflix 15 евро" →
{{
  "type": "create_subscription",
  "description": "Добавить подписку: Netflix (€15.00/мес)",
  "confidence": 0.85,
  "data": {{
    "name": "Netflix",
    "amount": 15.0,
    "currency": "EUR"
  }}
}}

User: "добавь кредит iPhone 111.25 евро в месяц" →
{{
  "type": "create_obligation",
  "description": "Добавить кредит: iPhone 17 Pro 256GB (€111.25/мес)",
  "confidence": 0.85,
  "data": {{
    "name": "iPhone 17 Pro 256GB (Алиса)",
    "monthly_payment": 111.25,
    "total_amount": 1335.0,
    "due_date": "2027-01-01",
    "category": "tech"
  }}
}}
"""


def load_action_context(db: Any) -> dict[str, list[dict[str, Any]]]:
    subscriptions = [
        dict(r)
        for r in fetch_all(
            db,
            """
            SELECT id, name, amount, currency, is_active
            FROM subscriptions
            ORDER BY COALESCE(is_active, 1) DESC, name ASC
            """,
        )
    ]
    obligations = [
        dict(r)
        for r in fetch_all(
            db,
            """
            SELECT id, name, monthly_payment, is_active
            FROM obligations
            ORDER BY COALESCE(is_active, 1) DESC, name ASC
            """,
        )
    ]
    projects = [
        dict(r)
        for r in fetch_all(
            db,
            """
            SELECT id, name, status
            FROM projects
            WHERE COALESCE(status, 'active') != 'archived'
            ORDER BY name ASC
            """,
        )
    ]
    try:
        open_loops = [
            dict(r)
            for r in fetch_all(
                db,
                """
                SELECT id, topic, domain, priority, status
                FROM open_loops
                WHERE COALESCE(status, 'open') = 'open'
                ORDER BY id DESC
                LIMIT 30
                """,
            )
        ]
    except Exception:
        open_loops = []
    return {
        "subscriptions": subscriptions,
        "obligations": obligations,
        "projects": projects,
        "open_loops": open_loops,
    }


def normalize_action(raw: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    action_type = str(raw.get("type") or "").strip()
    if action_type not in SUPPORTED_ACTION_TYPES:
        return None
    if action_type == "no_action":
        return {"type": "no_action"}
    description = str(raw.get("description") or "").strip()
    if not description:
        return None
    data = raw.get("data")
    if not isinstance(data, dict):
        data = {}
    confidence = raw.get("confidence")
    try:
        confidence_f = float(confidence) if confidence is not None else 0.85
    except (TypeError, ValueError):
        confidence_f = 0.85
    return {
        "type": action_type,
        "description": description,
        "confidence": round(confidence_f, 2),
        "data": data,
    }


async def detect_action(
    db: Any,
    user_message: str,
    assistant_response: str,
    api_key: str,
) -> dict[str, Any] | None:
    """Second Haiku pass: structured pending action from conversation."""
    if not api_key.strip():
        return None
    ctx = load_action_context(db)
    prompt = build_action_detection_prompt(
        user_message=user_message,
        assistant_response=assistant_response,
        subscriptions=ctx["subscriptions"],
        obligations=ctx["obligations"],
        projects=ctx["projects"],
        open_loops=ctx["open_loops"],
    )
    try:
        raw_text = await call_claude(prompt, api_key=api_key, model=DEFAULT_MODEL)
    except Exception:
        logger.exception("action_layer: Claude detection failed")
        return None
    parsed = parse_json_object(raw_text)
    print(f"action_layer detect: {raw_text}")
    action = normalize_action(parsed)
    print(f"action_layer parsed: {action}")
    if not action or action.get("type") == "no_action":
        return None
    logger.info(
        "action_layer: detected %s — %r",
        action.get("type"),
        action.get("description"),
    )
    return action


def _exec_log_workout(db: Any, data: dict[str, Any]) -> dict[str, Any] | None:
    today_iso = date.today().isoformat()
    adapted = {
        "date": data.get("date") or today_iso,
        "type": data.get("type"),
        "duration_minutes": data.get("duration") or data.get("duration_minutes"),
        "exercises": data.get("exercises"),
        "notes": data.get("notes"),
    }
    workout = _normalize_workout(adapted, today_iso)
    if workout is None:
        return None
    row = _save_workout(db, workout)
    if not row:
        return None
    return {
        "type": "workout",
        "id": int(row["id"]),
        "name": str(workout.get("type") or "workout"),
        "action": "created",
        "field": "workout",
        "new_value": workout.get("duration"),
        "currency": "EUR",
    }


def _exec_log_weight(db: Any, data: dict[str, Any]) -> dict[str, Any] | None:
    metric_date = str(data.get("date") or date.today().isoformat()).strip()
    weight = data.get("weight")
    try:
        weight_f = float(weight) if weight is not None else None
    except (TypeError, ValueError):
        return None
    if weight_f is None or weight_f <= 0:
        return None
    existing = fetch_one(
        db,
        "SELECT id, weight FROM body_metrics WHERE date = ?",
        (metric_date,),
    )
    if existing is None:
        metric_id = execute(
            db,
            """
            INSERT INTO body_metrics (date, weight, source, created_at)
            VALUES (?, ?, 'chat', datetime('now'))
            """,
            (metric_date, weight_f),
        )
    else:
        metric_id = int(existing["id"])
        execute(
            db,
            """
            UPDATE body_metrics
            SET weight = ?, source = 'chat', created_at = datetime('now')
            WHERE id = ?
            """,
            (weight_f, metric_id),
        )
    return {
        "type": "body_metric",
        "id": int(metric_id),
        "name": metric_date,
        "action": "created",
        "field": "weight",
        "new_value": weight_f,
        "currency": "EUR",
    }


def _exec_log_project_activity(db: Any, data: dict[str, Any]) -> dict[str, Any] | None:
    project_id = data.get("project_id")
    note = str(data.get("note") or "").strip()
    if project_id is None or not note:
        return None
    log_type = str(data.get("log_type") or "update").strip() or "update"
    project = fetch_one(db, "SELECT id, name FROM projects WHERE id = ?", (int(project_id),))
    if not project:
        return None
    log_id = execute(
        db,
        """
        INSERT INTO project_logs (project_id, note, log_type, source, created_at)
        VALUES (?, ?, ?, 'chat', datetime('now'))
        """,
        (int(project_id), note, log_type),
    )
    execute(
        db,
        "UPDATE projects SET updated_at = datetime('now') WHERE id = ?",
        (int(project_id),),
    )
    return {
        "type": "project_log",
        "id": int(log_id),
        "name": str(project.get("name") or ""),
        "action": "created",
        "field": "note",
        "new_value": note,
        "currency": "EUR",
    }


def _exec_create_open_loop(db: Any, data: dict[str, Any]) -> dict[str, Any] | None:
    topic = str(data.get("topic") or "").strip()
    if not topic:
        return None
    domain = str(data.get("domain") or "").strip() or None
    priority = str(data.get("priority") or "medium").strip() or "medium"
    loop_id = execute(
        db,
        """
        INSERT INTO open_loops (topic, domain, priority, status, created_at)
        VALUES (?, ?, ?, 'open', datetime('now'))
        """,
        (topic, domain, priority),
    )
    return {
        "type": "open_loop",
        "id": int(loop_id),
        "name": topic,
        "action": "created",
        "field": "topic",
        "new_value": topic,
        "currency": "EUR",
    }


def _exec_resolve_open_loop(db: Any, data: dict[str, Any]) -> dict[str, Any] | None:
    loop_id = data.get("id")
    if loop_id is None:
        return None
    row = fetch_one(
        db,
        "SELECT id, topic FROM open_loops WHERE id = ? AND COALESCE(status, 'open') = 'open'",
        (int(loop_id),),
    )
    if not row:
        return None
    execute(
        db,
        """
        UPDATE open_loops
        SET status = 'resolved', resolved_at = datetime('now')
        WHERE id = ?
        """,
        (int(loop_id),),
    )
    return {
        "type": "open_loop",
        "id": int(loop_id),
        "name": str(row.get("topic") or ""),
        "action": "resolved",
        "currency": "EUR",
    }


def _exec_set_reminder(db: Any, data: dict[str, Any]) -> dict[str, Any] | None:
    text = str(data.get("text") or "").strip()
    when = str(data.get("datetime") or "").strip()
    if not text or not when:
        return None
    reminder_id = execute(
        db,
        """
        INSERT INTO followups (event_text, followup_date, question, status, created_at)
        VALUES (?, ?, ?, 'pending', datetime('now'))
        """,
        (text, when, text),
    )
    return {
        "type": "reminder",
        "id": int(reminder_id),
        "name": text,
        "action": "created",
        "field": "reminder",
        "new_value": when,
        "currency": "EUR",
    }


def _exec_update_subscription_field(
    db: Any, data: dict[str, Any]
) -> dict[str, Any] | None:
    row_id = data.get("id")
    field = str(data.get("field") or "amount").strip().lower()
    value = data.get("value")
    if row_id is None or value is None:
        return None
    row = fetch_one(
        db,
        "SELECT id, name, amount, currency FROM subscriptions WHERE id = ?",
        (int(row_id),),
    )
    if not row:
        return None
    if field == "name":
        new_name = str(value).strip()
        if not new_name:
            return None
        old_name = str(row.get("name") or "")
        execute(
            db,
            "UPDATE subscriptions SET name = ?, source = 'chat', "
            "updated_at = datetime('now') WHERE id = ?",
            (new_name, int(row_id)),
        )
        return {
            "type": "subscription",
            "id": int(row_id),
            "name": new_name,
            "action": "updated",
            "field": "name",
            "old_value": old_name,
            "new_value": new_name,
            "currency": str(row.get("currency") or "EUR"),
        }
    if field == "amount":
        action = {
            "type": "update_subscription",
            "data": {
                "kind": "subscription",
                "id": int(row_id),
                "name": row.get("name"),
                "amount": float(value),
                "currency": row.get("currency") or "EUR",
            },
        }
        return apply_pending_recurring_action(db, action)
    return None


_OBLIGATION_UPDATE_FIELDS = frozenset({
    "total_amount",
    "remaining_amount",
    "monthly_payment",
    "interest_rate",
    "due_date",
    "name",
    "category",
})
_OBLIGATION_NUMERIC_FIELDS = frozenset({
    "total_amount",
    "remaining_amount",
    "monthly_payment",
    "interest_rate",
})


def _coerce_obligation_field(key: str, value: Any) -> Any:
    if key in _OBLIGATION_NUMERIC_FIELDS:
        if value is None:
            return None
        try:
            return float(value)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Invalid numeric value for {key}: {value!r}") from exc
    if key == "due_date":
        s = str(value or "").strip()
        return s or None
    if key in ("name", "category"):
        s = str(value or "").strip()
        return s or None
    return value


def _exec_update_obligation(db: Any, data: dict[str, Any]) -> dict[str, Any] | None:
    """Update one or more obligation columns in a single statement."""
    row_id = data.get("id")
    if row_id is None:
        raise ValueError("Missing id")

    row = fetch_one(
        db,
        """
        SELECT id, name, total_amount, remaining_amount, monthly_payment,
               interest_rate, due_date, category, is_active
        FROM obligations
        WHERE id = ?
        """,
        (int(row_id),),
    )
    if not row:
        raise ValueError(f"Obligation id={row_id} not found")

    fields: dict[str, Any] = {}

    field = str(data.get("field") or "").strip().lower()
    value = data.get("value")
    if field and value is not None:
        key = "monthly_payment" if field == "amount" else field
        if key in _OBLIGATION_UPDATE_FIELDS:
            fields[key] = _coerce_obligation_field(key, value)

    if data.get("amount") is not None and "monthly_payment" not in fields:
        fields["monthly_payment"] = _coerce_obligation_field(
            "monthly_payment", data["amount"]
        )

    for key in _OBLIGATION_UPDATE_FIELDS:
        if key in data and data[key] is not None:
            fields[key] = _coerce_obligation_field(key, data[key])

    if not fields:
        raise ValueError("Missing id or fields")

    set_clause = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [int(row_id)]
    execute(
        db,
        f"UPDATE obligations SET {set_clause}, source = 'chat', "
        f"updated_at = datetime('now') WHERE id = ?",
        tuple(values),
    )

    name = str(fields.get("name") or row.get("name") or "")
    result: dict[str, Any] = {
        "type": "obligation",
        "id": int(row_id),
        "name": name,
        "action": "updated",
        "currency": "EUR",
    }

    if "monthly_payment" in fields:
        old_monthly = row.get("monthly_payment")
        result["field"] = "monthly_payment"
        result["old_value"] = (
            float(old_monthly) if old_monthly is not None else None
        )
        result["new_value"] = float(fields["monthly_payment"])
    elif len(fields) == 1:
        only_key = next(iter(fields))
        result["field"] = only_key
        result["old_value"] = row.get(only_key)
        result["new_value"] = fields[only_key]
    else:
        result["field"] = "obligation"

    return result


def _exec_create_obligation(db: Any, data: dict[str, Any]) -> dict[str, Any] | None:
    """Insert a new obligation row (or update an existing chat-sourced row)."""
    name = str(data.get("name") or "").strip()
    if not name:
        return None

    monthly_payment = data.get("monthly_payment")
    total_amount = data.get("total_amount")
    remaining_amount = data.get("remaining_amount")
    due_date = str(data.get("due_date") or "").strip() or None
    category = str(data.get("category") or "loan").strip() or "loan"

    def _pos_float(val: Any) -> float | None:
        if val is None:
            return None
        try:
            f = float(val)
        except (TypeError, ValueError):
            return None
        return f if f > 0 else None

    monthly_f = _pos_float(monthly_payment)
    total_f = _pos_float(total_amount)
    remaining_f = _pos_float(remaining_amount)
    if monthly_f is None and total_f is None and remaining_f is None:
        return None

    existing = fetch_one(
        db,
        "SELECT id, source, monthly_payment FROM obligations WHERE LOWER(name) = LOWER(?)",
        (name,),
    )
    if existing is not None:
        if str(existing.get("source") or "").lower() == "manual":
            return None
        old_monthly = existing.get("monthly_payment")
        execute(
            db,
            """
            UPDATE obligations
               SET monthly_payment = COALESCE(?, monthly_payment),
                   total_amount = COALESCE(?, total_amount),
                   remaining_amount = COALESCE(?, remaining_amount),
                   due_date = COALESCE(?, due_date),
                   category = ?,
                   is_active = 1,
                   source = 'chat',
                   updated_at = datetime('now')
             WHERE id = ?
            """,
            (
                monthly_f,
                total_f,
                remaining_f,
                due_date,
                category,
                int(existing["id"]),
            ),
        )
        reported = monthly_f or total_f or remaining_f or 0.0
        return {
            "type": "obligation",
            "id": int(existing["id"]),
            "name": name,
            "action": "updated",
            "field": "monthly_payment",
            "old_value": float(old_monthly) if old_monthly is not None else None,
            "new_value": float(reported),
            "currency": "EUR",
        }

    new_id = execute(
        db,
        """
        INSERT INTO obligations
            (name, monthly_payment, total_amount, remaining_amount,
             due_date, category, is_active, source, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, 'chat', datetime('now'), datetime('now'))
        """,
        (name, monthly_f, total_f, remaining_f, due_date, category),
    )
    reported = monthly_f or total_f or remaining_f or 0.0
    return {
        "type": "obligation",
        "id": int(new_id),
        "name": name,
        "action": "created",
        "field": "monthly_payment",
        "new_value": float(reported),
        "currency": "EUR",
    }


def execute_action(db: Any, action: dict[str, Any]) -> dict[str, Any] | None:
    """Apply a confirmed pending action. Returns a result dict for the UI."""
    action_type = str(action.get("type") or "")
    data = action.get("data") or {}
    if action_type == "no_action":
        return None

    if action_type in _FINANCE_ACTION_TYPES:
        if action_type == "create_obligation":
            return _exec_create_obligation(db, data)
        if action_type == "update_subscription":
            field = str(data.get("field") or "amount").strip().lower()
            if field == "name":
                return _exec_update_subscription_field(db, data)
            return apply_pending_recurring_action(db, action)
        if action_type == "update_obligation":
            try:
                return _exec_update_obligation(db, data)
            except Exception as e:
                print(f"update_obligation error: {e}")
                traceback.print_exc()
                raise
        return apply_pending_recurring_action(db, action)

    if action_type == "log_workout":
        return _exec_log_workout(db, data)
    if action_type == "log_weight":
        return _exec_log_weight(db, data)
    if action_type == "log_project_activity":
        return _exec_log_project_activity(db, data)
    if action_type == "create_open_loop":
        return _exec_create_open_loop(db, data)
    if action_type == "resolve_open_loop":
        return _exec_resolve_open_loop(db, data)
    if action_type == "set_reminder":
        return _exec_set_reminder(db, data)

    logger.warning("action_layer: unhandled action type %r", action_type)
    return None


def format_action_result(result: dict[str, Any]) -> str:
    """Human-readable confirmation line after a confirmed action."""
    from services.subscription_updater import format_confirmation

    action = str(result.get("action") or "").lower()
    name = str(result.get("name") or "?")
    field = str(result.get("field") or "")

    if action in ("deleted", "updated", "created", "restored"):
        finance = format_confirmation([result]).strip()
        if finance:
            return finance

    if action == "resolved":
        return f"_Закрыто: {name}_"
    if field == "weight":
        try:
            w = float(result.get("new_value"))
            return f"_Записан вес: {w:.1f} кг_"
        except (TypeError, ValueError):
            return f"_Записан вес: {name}_"
    if field == "workout":
        return f"_Записана тренировка: {name}_"
    if field == "note":
        return f"_Записано в проект {name}_"
    if field == "reminder":
        return f"_Напоминание установлено: {name}_"
    if field == "topic":
        return f"_Открыт цикл: {name}_"
    return f"_Готово: {name}_"
