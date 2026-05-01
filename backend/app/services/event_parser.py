"""Observer Parsing v1: deterministic local domain hints + signals (replaceable later)."""

from __future__ import annotations

import re
from typing import Any

_PARSER_VERSION = "v1"


def _lower_fold(text: str) -> str:
    return " ".join(text.split()).lower()


def _signals(lowered: str, raw: str) -> list[str]:
    """Derive simple lexical signals (stable names for observers)."""
    out: list[str] = []

    if re.search(r"\d", raw):
        out.append("contains_number")
    if re.search(r"[€$£]|(?:\b(?:eur|usd|gbp)\b)", lowered):
        out.append("contains_money")
    if re.search(
        r"\b\d+\s*(?:hours?|hrs?|minutes?|mins?)\b|\b\d+\s*h\b(?=\s|$|[,.])",
        lowered,
    ):
        out.append("contains_duration")
    if re.search(r"\d+\s*[x×]\s*\d+", lowered) or re.search(
        r"\b\d+\s*(?:kg|lbs?)\b", lowered
    ):
        out.append("contains_weight_or_reps")

    project_kw = (
        "worked on",
        "fixed",
        "implemented",
        "event memory",
        "roadmap",
        "architecture",
        "product",
        "backend",
        "mvp",
        "feature",
        "deploy",
        "refactor",
    )
    if re.search(r"\bbug\b", lowered) or any(k in lowered for k in project_kw):
        out.append("contains_project_keyword")

    emotion_kw = (
        "argument",
        "angry",
        "anxious",
        "sad",
        "motivated",
        "felt bad",
        "colleague",
        "frustrated",
        "happy",
        "excited",
        "lonely",
        "overwhelmed",
    )
    if any(k in lowered for k in emotion_kw):
        out.append("contains_emotion_keyword")

    return sorted(set(out))


def _has_idea(t: str) -> bool:
    if "idea:" in t:
        return True
    if "maybe we should" in t:
        return True
    if "thought about pivoting" in t or ("thought about" in t and "pivot" in t):
        return True
    if re.search(r"\bconcept\b", t):
        return True
    return False


def _has_finance(t: str, signal_names: set[str]) -> bool:
    if "contains_money" in signal_names:
        return True
    finance_kw = (
        "paid invoice",
        "salary",
        "rent",
        "debt",
        "invoice",
        "budget",
        "expense",
        "subscription",
    )
    if any(k in t for k in finance_kw):
        return True
    if "spent" in t and ("groceries" in t or "money" in t or re.search(r"[€$£]", t)):
        return True
    return False


def _has_training(t: str) -> bool:
    training_kw = (
        "bench press",
        "deadlift",
        "squat",
        "workout",
        "gym",
        "ran ",
        " run ",
        "running",
        "5km",
        " km",
        "cardio",
        "lifting",
        "reps",
        "warmup",
        "pr ",
        " pb",
    )
    return any(k in t for k in training_kw)


def _has_health(t: str) -> bool:
    health_kw = (
        "slept",
        "sleep",
        "headache",
        "sick",
        "tired",
        "recovery",
        "stress",
        "insomnia",
        "fever",
        "pain",
    )
    return any(k in t for k in health_kw)


def _has_emotion(t: str) -> bool:
    emotion_kw = (
        "argument with",
        "argument ",
        "angry",
        "anxious",
        "sad",
        "motivated",
        "felt bad",
        "felt good",
        "frustrated",
        "overwhelmed",
        "colleague",
    )
    return any(k in t for k in emotion_kw)


def _has_knowledge(t: str) -> bool:
    knowledge_kw = (
        "read article",
        "watched lecture",
        "learned",
        "studied",
        "lecture",
        "tutorial",
        "documentation",
        "docs",
    )
    if any(k in t for k in knowledge_kw):
        return True
    if re.search(r"\bbook\b", t) or re.search(r"\bnotes\b", t):
        return True
    return False


def _has_project(t: str) -> bool:
    project_kw = (
        "worked on",
        "fixed",
        "implemented",
        "event memory",
        "roadmap",
        "architecture",
        "product",
        "backend",
        "mvp",
        "bug",
        "refactor",
        "deploy",
        "feature",
    )
    return any(k in t for k in project_kw)


def _classify_domain(t: str, signal_names: set[str]) -> str:
    """First-match priority keeps v1 predictable; refine with scores later if needed."""
    if _has_idea(t):
        return "idea"
    if _has_finance(t, signal_names):
        return "finance"
    if _has_training(t):
        return "training"
    if _has_health(t):
        return "health"
    if _has_emotion(t):
        return "emotion"
    if _has_knowledge(t):
        return "knowledge"
    if _has_project(t):
        return "project"
    return "general"


def parse_event(text: str) -> dict[str, Any]:
    """
    Return observer metadata for an event string (typically processed_text).

    Fields: domain, source, raw_length, parser_version, signals.
    """
    folded = _lower_fold(text)
    sig_list = _signals(folded, text)
    signal_names = set(sig_list)
    domain = _classify_domain(folded, signal_names)
    return {
        "domain": domain,
        "source": "manual",
        "raw_length": len(text),
        "parser_version": _PARSER_VERSION,
        "signals": sig_list,
    }
