from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, model_validator


class UploadSummaryOut(BaseModel):
    upload_id: int
    filename: str
    account_ibans: list[str]
    period_start: str | None
    period_end: str | None
    total_transactions: int
    new_transactions: int
    skipped_duplicates: int
    categories: dict[str, int]


class UploadOut(BaseModel):
    id: int
    filename: str
    account_iban: str | None = None
    period_start: str | None = None
    period_end: str | None = None
    total_transactions: int
    created_at: str | None = None


class UploadDeleteOut(BaseModel):
    deleted: bool
    transactions_removed: int


class ChatAttachment(BaseModel):
    """Image / PDF attached to a user chat turn.

    `data` is base64-encoded raw bytes (no `data:` URI prefix). The router
    validates size + media-type before forwarding to the LLM.
    """

    data: str
    media_type: str
    name: str | None = None


class ChatIn(BaseModel):
    message: str
    history: list[dict[str, Any]] = Field(default_factory=list)
    current_page: str | None = None
    # Optional routing for Overview → chat handoff (domain-focused dialogue).
    surface: str | None = None
    agent: str | None = None  # finance | projects | health
    # Optional file upload. JSON over `/api/chat` so the streaming
    # path stays unchanged; multipart would force a parallel codepath
    # without buying anything for ≤10 MB payloads.
    file_data: str | None = None
    file_type: str | None = None
    file_name: str | None = None


class ChatOut(BaseModel):
    response: str
    event_saved: dict[str, Any] | None = None
    facts_saved: list[dict[str, Any]] = Field(default_factory=list)
    recurring_updated: list[dict[str, Any]] = Field(default_factory=list)
    pending_actions: list[dict[str, Any]] = Field(default_factory=list)


class PendingActionIn(BaseModel):
    type: str
    description: str
    data: dict[str, Any] = Field(default_factory=dict)
    confidence: float | None = None


class ConfirmActionIn(BaseModel):
    action: PendingActionIn

    @model_validator(mode="before")
    @classmethod
    def _unwrap_direct_action(cls, data: Any) -> Any:
        if isinstance(data, dict) and "type" in data and "action" not in data:
            return {"action": data}
        return data


class CancelActionIn(BaseModel):
    action: PendingActionIn

    @model_validator(mode="before")
    @classmethod
    def _unwrap_direct_action(cls, data: Any) -> Any:
        if isinstance(data, dict) and "type" in data and "action" not in data:
            return {"action": data}
        return data


class ConfirmActionOut(BaseModel):
    message: str
    recurring_updated: list[dict[str, Any]] = Field(default_factory=list)


class CancelActionOut(BaseModel):
    message: str


class ChatMessageOut(BaseModel):
    id: int
    role: str
    content: str
    page: str | None = None
    created_at: str | None = None
    attachment: ChatAttachment | None = None


class ChatHistoryOut(BaseModel):
    messages: list[ChatMessageOut] = Field(default_factory=list)


class FeedItem(BaseModel):
    type: str  # 'transaction' | 'subscription' | 'upload' | 'project_log' | 'event' | 'observation'
    title: str
    subtitle: str | None = None
    amount: float | None = None
    currency: str | None = None
    icon: str | None = None
    created_at: str  # ISO timestamp used for chronological ordering


class FeedOut(BaseModel):
    items: list[FeedItem] = Field(default_factory=list)


class CategorySummary(BaseModel):
    amount: float
    count: int


class InternalTransferSummary(BaseModel):
    amount: float
    count: int


class OtherIncomingSummary(BaseModel):
    amount: float = 0.0
    count: int = 0


class SummaryOut(BaseModel):
    period_start: str | None
    period_end: str | None
    total_spent: float
    total_income: float
    by_category: dict[str, CategorySummary]
    internal_transfers: InternalTransferSummary = InternalTransferSummary(
        amount=0.0, count=0
    )
    other_incoming: OtherIncomingSummary = OtherIncomingSummary(amount=0.0, count=0)
    # Cycle projection — derived in summary_loader. Defaults are
    # neutral (0 / 0.0) so historical or empty cycles don't surface a
    # bogus forecast in the UI.
    days_elapsed: int = 0
    days_remaining: int = 0
    daily_spend_rate: float = 0.0
    forecast_end_of_cycle: float = 0.0
    burn_rate_days: int = 0


class CycleRange(BaseModel):
    start: str
    end: str


class FinanceCyclesOut(BaseModel):
    active: CycleRange
    latest_with_data: CycleRange | None = None
    earliest_with_data: CycleRange | None = None


class ResolvedGoal(BaseModel):
    """A goal_key joined with its display title from `user_facts` or
    `user_profile.goals`. `title` is None for orphaned keys (the goal
    was deleted but the project still references it) so the FE can
    fall back to showing the raw key as a degraded pill instead of
    silently dropping the link."""

    key: str
    title: str | None = None
    source: str | None = None


class ProjectOut(BaseModel):
    id: int
    name: str
    description: str | None = None
    status: str = "active"
    priority: int = 2
    started_at: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    total_sessions_minutes: int = 0
    # Raw goal identifiers persisted with the project. Empty list
    # when none linked (NULL in DB → []).
    goal_keys: list[str] = Field(default_factory=list)
    # Same identifiers, joined with their display titles. Always the
    # same length and order as `goal_keys` for FE convenience.
    goals: list[ResolvedGoal] = Field(default_factory=list)


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    status: str = "active"
    priority: int = 2


class ProjectGoalsIn(BaseModel):
    """Payload for `PUT /api/projects/{id}/goals`. Strings can be
    any goal identifier returned by `/api/goals` — `user_facts.key`
    for chat-derived goals or `profile:<idx>` for profile goals."""

    goal_keys: list[str] = Field(default_factory=list)


class ProjectLogOut(BaseModel):
    id: int
    note: str
    log_type: str = "update"
    duration_minutes: int | None = None
    source: str = "manual"
    created_at: str | None = None


class ActiveSessionOut(BaseModel):
    started_at: str


class ProjectDetailOut(ProjectOut):
    logs: list[ProjectLogOut] = Field(default_factory=list)
    total_sessions_minutes: int = 0
    active_session: ActiveSessionOut | None = None


class ProjectLogIn(BaseModel):
    note: str = Field(min_length=1, max_length=2000)
    log_type: str = "update"


class SessionStartOut(BaseModel):
    started_at: str
    log_id: int


class SessionStopIn(BaseModel):
    label: str = Field(min_length=1, max_length=200)


class ProjectTodoOut(BaseModel):
    id: int
    project_id: int
    text: str
    done: bool = False
    done_at: str | None = None
    created_at: str | None = None


class ProjectTodoIn(BaseModel):
    text: str = Field(min_length=1, max_length=500)


class ProjectTodosListOut(BaseModel):
    todos: list[ProjectTodoOut] = Field(default_factory=list)


class DilemmaOut(BaseModel):
    """Decision Memory record. `decision_made` is the user's choice,
    `outcome` is what actually happened (filled by the follow-up loop
    ~14 days after the decision), `tags` is a list of free-form
    domain markers (finance, health, career, ...).
    """

    id: int
    title: str
    description: str | None = None
    options: str | None = None
    analysis: str | None = None
    recommendation: str | None = None
    status: str = "open"
    followup_due: str | None = None
    followup_done: bool = False
    followup_answer: str | None = None
    decision_made: str | None = None
    outcome: str | None = None
    tags: list[str] = Field(default_factory=list)
    created_at: str | None = None


class DilemmaIn(BaseModel):
    """Create a new dilemma. Used by the chat decision extractor and
    by future manual-entry UI. `followup_due` defaults to today + 14
    days server-side when omitted."""

    title: str = Field(min_length=1, max_length=300)
    description: str | None = None
    options: str | None = None
    analysis: str | None = None
    recommendation: str | None = None
    status: str = "open"
    decision_made: str | None = None
    tags: list[str] = Field(default_factory=list)
    followup_due: str | None = None  # ISO date YYYY-MM-DD


class DilemmaPatch(BaseModel):
    """Partial update — any subset of fields. Used to record the
    decision, the outcome, or to flip status without rewriting the
    whole row."""

    title: str | None = None
    description: str | None = None
    options: str | None = None
    analysis: str | None = None
    recommendation: str | None = None
    status: str | None = None
    decision_made: str | None = None
    outcome: str | None = None
    tags: list[str] | None = None
    followup_due: str | None = None


class FollowupAnswerIn(BaseModel):
    """Body for POST /dilemmas/{id}/followup-answer. The answer is
    stored verbatim in `followup_answer` AND mirrored into `outcome`
    when `outcome` is still empty, so the Dilemmas page has a single
    source of truth for "what happened" without overwriting a manual
    edit."""

    answer: str = Field(min_length=1, max_length=2000)


class DilemmaStatsOut(BaseModel):
    """Aggregate counters surfaced by GET /dilemmas/stats. Used by the
    Dilemmas page header and any future "decision health" widgets."""

    total: int = 0
    open: int = 0
    decided: int = 0
    closed: int = 0
    abandoned: int = 0
    followups_due: int = 0
    followups_completed: int = 0
    followup_rate: float = 0.0
    top_tags: list[dict[str, Any]] = Field(default_factory=list)


class TransactionOut(BaseModel):
    id: int
    upload_id: int | None = None
    date: str
    description: str | None = None
    amount: float
    currency: str = "EUR"
    category: str | None = None
    category_confirmed: bool = False
    account_iban: str | None = None
    is_debit: bool = True
    is_internal_transfer: bool = False
    raw_description: str | None = None
    created_at: str | None = None


class InsightOut(BaseModel):
    type: str
    title: str
    description: str
    amount_mentioned: float | None = None


class ObservationOut(BaseModel):
    id: int
    title: str
    body: str
    observation_type: str = "pattern"
    is_read: bool = False
    created_at: str | None = None


class ObservationGenerateOut(BaseModel):
    generated: int
    observations: list[ObservationOut] = Field(default_factory=list)


class CrossSphereInsightOut(BaseModel):
    """A correlation between two life spheres surfaced by the analyzer.

    `sphere1`/`sphere2` map 1:1 to the FE domain palette
    (finance/health/projects/life), which is why we keep them as raw
    strings instead of an enum — adding a new sphere should not
    require a schema migration.

    `evidence` is the raw rule-layer payload (week counts, averages,
    affected project list, …). The FE doesn't render it today but
    keeps it around so future "Объяснить" / "Открыть факт" affordances
    don't need another request.
    """

    id: int
    sphere1: str
    sphere2: str
    title: str
    description: str
    confidence: float = 0.5
    evidence: dict[str, Any] | None = None
    is_active: bool = True
    expires_at: str | None = None
    created_at: str | None = None


class CrossSphereInsightsOut(BaseModel):
    insights: list[CrossSphereInsightOut] = Field(default_factory=list)


class PaginatedTransactionsOut(BaseModel):
    total: int
    skip: int
    limit: int
    items: list[TransactionOut]


class BodyMetricOut(BaseModel):
    id: int
    date: str
    weight: float | None = None
    height: float | None = None
    body_fat: float | None = None
    notes: str | None = None
    source: str = "manual"
    created_at: str | None = None


class BodyMetricIn(BaseModel):
    date: str | None = None
    weight: float | None = None
    height: float | None = None
    body_fat: float | None = None
    notes: str | None = None


class WorkoutSetOut(BaseModel):
    setNumber: int
    weight: float | None = None
    reps: int | None = None


class WorkoutExerciseOut(BaseModel):
    exerciseName: str
    muscleGroup: str | None = None
    sets: list[WorkoutSetOut] = Field(default_factory=list)


class WorkoutOut(BaseModel):
    id: int
    date: str
    type: str | None = None
    duration: int | None = None
    exercises: list[WorkoutExerciseOut] = Field(default_factory=list)
    energy_level: int | None = None
    notes: str | None = None
    source: str = "chat"
    created_at: str | None = None
    total_volume: float | None = None


class WorkoutIn(BaseModel):
    date: str | None = None
    type: str | None = None
    duration: int | None = None
    notes: str | None = None
    energy_level: int | None = None
    exercises: list[WorkoutExerciseOut] = Field(default_factory=list)


class TrainingLogImportOut(BaseModel):
    imported: int
    skipped: int
    workouts: list[WorkoutOut] = Field(default_factory=list)
    chat_notice: str | None = None


class DiscoveryGapOut(BaseModel):
    id: int
    category: str
    question_hint: str
    priority: int = 2
    status: str = "open"
    learned_value: str | None = None
    last_asked: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class DiscoveryGapsListOut(BaseModel):
    gaps: list[DiscoveryGapOut] = Field(default_factory=list)


class HealthMarkerOut(BaseModel):
    id: int
    marker_name: str
    value: float
    unit: str | None = None
    reference_min: float | None = None
    reference_max: float | None = None
    status: str = "NORMAL"
    source: str = "manual"
    created_at: str | None = None


class HealthCheckupGroupOut(BaseModel):
    date: str
    markers: list[HealthMarkerOut] = Field(default_factory=list)


class HealthCheckupsListOut(BaseModel):
    checkups: list[HealthCheckupGroupOut] = Field(default_factory=list)


class HealthMarkerHistoryPoint(BaseModel):
    """One historical sample for a single biomarker.

    `marker_name` echoes the *canonical* (most recent) name across all
    aliases — the API matches names case-insensitively so that minor
    casing/spacing drift between checkups still groups under one trend.
    """

    date: str
    value: float
    unit: str | None = None
    status: str = "NORMAL"
    reference_min: float | None = None
    reference_max: float | None = None


class HealthMarkerHistoryOut(BaseModel):
    marker_name: str
    points: list[HealthMarkerHistoryPoint] = Field(default_factory=list)


class UserProfileSectionOut(BaseModel):
    name: str | None = None
    city: str | None = None
    profession: str | None = None
    monthly_income: float | None = None
    goals: list[str] = Field(default_factory=list)
    context: str | None = None


class UserFactOut(BaseModel):
    key: str
    value: str
    confidence: float = 1.0
    updated_at: str | None = None


class ProfileStatsOut(BaseModel):
    total_transactions: int = 0
    total_events: int = 0
    facts_count: int = 0
    member_since: str | None = None


class ProfileBundleOut(BaseModel):
    profile: UserProfileSectionOut
    facts: list[UserFactOut] = Field(default_factory=list)
    stats: ProfileStatsOut


class EventOut(BaseModel):
    id: int
    date: str
    title: str
    description: str | None = None
    domain: str
    category: str | None = None
    importance: int = 2
    created_at: str | None = None


class EventsListOut(BaseModel):
    events: list[EventOut] = Field(default_factory=list)
    total: int = 0


class GoalItemOut(BaseModel):
    id: int
    title: str
    source: str
    key: str | None = None


class GoalsListOut(BaseModel):
    goals: list[GoalItemOut] = Field(default_factory=list)


class HypothesisOut(BaseModel):
    id: int
    text: str
    status: str = "pending"
    confidence: float = 0.5
    evidence_count: int = 1
    domains: list[str] = Field(default_factory=list)
    created_at: str | None = None


class HypothesesListOut(BaseModel):
    hypotheses: list[HypothesisOut] = Field(default_factory=list)


class SubscriptionOut(BaseModel):
    id: int
    name: str
    amount: float | None = None
    currency: str = "EUR"
    billing_day: int | None = None
    category: str = "other"
    is_active: bool = True
    source: str = "manual"
    created_at: str | None = None
    updated_at: str | None = None


class SubscriptionIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    amount: float | None = None
    currency: str = "EUR"
    billing_day: int | None = None
    category: str = "other"


class SubscriptionUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    amount: float | None = None
    currency: str | None = None
    billing_day: int | None = None
    category: str | None = None
    is_active: bool | None = None


class SubscriptionsListOut(BaseModel):
    subscriptions: list[SubscriptionOut] = Field(default_factory=list)


class ObligationOut(BaseModel):
    id: int
    name: str
    total_amount: float | None = None
    remaining_amount: float | None = None
    monthly_payment: float | None = None
    interest_rate: float | None = None
    due_date: str | None = None
    category: str = "loan"
    is_active: bool = True
    source: str = "manual"
    created_at: str | None = None
    updated_at: str | None = None


class ObligationIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    total_amount: float | None = None
    remaining_amount: float | None = None
    monthly_payment: float | None = None
    interest_rate: float | None = None
    due_date: str | None = None
    category: str = "loan"


class ObligationUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    total_amount: float | None = None
    remaining_amount: float | None = None
    monthly_payment: float | None = None
    interest_rate: float | None = None
    due_date: str | None = None
    category: str | None = None
    is_active: bool | None = None


class ObligationsListOut(BaseModel):
    obligations: list[ObligationOut] = Field(default_factory=list)


class MonthlyFixedOut(BaseModel):
    subscriptions_total: float = 0.0
    obligations_total: float = 0.0
    fixed_total: float = 0.0
    subscriptions_count: int = 0
    obligations_count: int = 0


class CategoryRuleOut(BaseModel):
    """Merchant→category mapping learned from a user confirmation
    (or seeded by a future system rule). Exposed via
    `GET /api/category-rules` so the UI can show which merchants
    auto-categorize and how often each rule has fired."""

    id: int
    pattern: str
    category: str
    match_type: str = "contains"
    confidence: float = 1.0
    times_applied: int = 0
    source: str = "user"
    created_at: str | None = None
    updated_at: str | None = None


class CategoryRulesListOut(BaseModel):
    rules: list[CategoryRuleOut] = Field(default_factory=list)


class DeleteResultOut(BaseModel):
    deleted: bool = False
    id: int


class InterviewQuestionOut(BaseModel):
    has_question: bool = False
    question: str | None = None
    domain: str | None = None


class InterviewAnswerIn(BaseModel):
    question: str
    answer: str


class InterviewAnswerOut(BaseModel):
    saved: bool


class SpaceSuggestMessageIn(BaseModel):
    role: str
    content: str


class SpaceSuggestIn(BaseModel):
    messages: list[SpaceSuggestMessageIn] = Field(default_factory=list)


class SpaceSuggestOut(BaseModel):
    suggest: bool
    name: str | None = None
    reason: str | None = None


class SpaceIn(BaseModel):
    name: str
    icon: str | None = None


class SpaceOut(BaseModel):
    id: int
    name: str
    icon: str
    created_at: str | None = None
    last_active: str | None = None


class IdentityOut(BaseModel):
    id: int
    category: str
    insight: str
    confidence: float
    evidence_count: int
    created_at: str | None = None
    updated_at: str | None = None


class FollowupOut(BaseModel):
    id: int
    event_text: str
    followup_date: str
    question: str
    status: str
    created_at: str | None = None
