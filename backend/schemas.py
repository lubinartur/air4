from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


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


class ChatIn(BaseModel):
    message: str
    history: list[dict[str, Any]] = Field(default_factory=list)
    current_page: str | None = None


class ChatOut(BaseModel):
    response: str
    event_saved: dict[str, Any] | None = None
    facts_saved: list[dict[str, Any]] = Field(default_factory=list)


class CategorySummary(BaseModel):
    amount: float
    count: int


class InternalTransferSummary(BaseModel):
    amount: float
    count: int


class SummaryOut(BaseModel):
    period_start: str | None
    period_end: str | None
    total_spent: float
    total_income: float
    by_category: dict[str, CategorySummary]
    internal_transfers: InternalTransferSummary = InternalTransferSummary(
        amount=0.0, count=0
    )


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


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    status: str = "active"
    priority: int = 2


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
    created_at: str | None = None


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


class FinanceSubscriptionOut(BaseModel):
    key: str
    name: str
    amount: float | None = None
    currency: str = "EUR"
    raw: str


class SubscriptionsListOut(BaseModel):
    subscriptions: list[FinanceSubscriptionOut] = Field(default_factory=list)


class FinanceObligationOut(BaseModel):
    key: str
    name: str
    amount: float | None = None
    monthly_payment: float | None = None
    raw: str


class ObligationsListOut(BaseModel):
    obligations: list[FinanceObligationOut] = Field(default_factory=list)


class InterviewQuestionOut(BaseModel):
    has_question: bool = False
    question: str | None = None
    domain: str | None = None


class InterviewAnswerIn(BaseModel):
    question: str
    answer: str


class InterviewAnswerOut(BaseModel):
    saved: bool
