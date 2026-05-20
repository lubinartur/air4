export type CategorySummary = {
  amount: number;
  count: number;
};

export type InternalTransferSummary = {
  amount: number;
  count: number;
};

export type Summary = {
  period_start: string | null;
  period_end: string | null;
  total_spent: number;
  total_income: number;
  by_category: Record<string, CategorySummary>;
  internal_transfers?: InternalTransferSummary;
};

export type Project = {
  id: number;
  name: string;
  description?: string | null;
  status: string;
  started_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type Dilemma = {
  id: number;
  title: string;
  description?: string | null;
  status: string;
  recommendation?: string | null;
  followup_due?: string | null;
  followup_done?: boolean | number;
  created_at?: string | null;
};

export type Observation = {
  id: number;
  title: string;
  body: string;
  observation_type: string;
  is_read: boolean;
  created_at?: string | null;
};

export type Transaction = {
  id: number;
  date: string;
  description?: string | null;
  amount: number;
  currency: string;
  category?: string | null;
  is_debit: boolean;
};

export type TransactionsPage = {
  total: number;
  skip: number;
  limit: number;
  items: Transaction[];
};

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export async function getSummary(): Promise<Summary> {
  return apiFetch<Summary>("/api/summary");
}

export const fetchSummary = getSummary;

export type FinanceSubscription = {
  key: string;
  name: string;
  amount: number | null;
  currency: string;
  raw: string;
};

export type SubscriptionsResponse = {
  subscriptions: FinanceSubscription[];
};

export type FinanceObligation = {
  key: string;
  name: string;
  amount: number | null;
  monthly_payment: number | null;
  raw: string;
};

export type ObligationsResponse = {
  obligations: FinanceObligation[];
};

export async function fetchSubscriptions(): Promise<SubscriptionsResponse> {
  const data = await apiFetch<SubscriptionsResponse>("/api/finance/subscriptions");
  return { subscriptions: data.subscriptions ?? [] };
}

export async function fetchObligations(): Promise<ObligationsResponse> {
  const data = await apiFetch<ObligationsResponse>("/api/finance/obligations");
  return { obligations: data.obligations ?? [] };
}

export type BodyMetric = {
  id: number;
  date: string;
  weight?: number | null;
  height?: number | null;
  body_fat?: number | null;
  notes?: string | null;
  source?: string;
  created_at?: string | null;
};

function normalizeBodyMetric(raw: Record<string, unknown>): BodyMetric {
  const weight =
    raw.weight != null && raw.weight !== "" ? Number(raw.weight) : null;
  const height =
    raw.height != null && raw.height !== "" ? Number(raw.height) : null;
  return {
    id: Number(raw.id),
    date: String(raw.date ?? ""),
    weight: weight != null && Number.isFinite(weight) ? weight : null,
    height: height != null && Number.isFinite(height) ? height : null,
    body_fat: raw.body_fat != null ? Number(raw.body_fat) : null,
    notes: raw.notes != null ? String(raw.notes) : null,
    source: raw.source != null ? String(raw.source) : undefined,
    created_at: raw.created_at != null ? String(raw.created_at) : null,
  };
}

export function sortMetricsByDateDesc(metrics: BodyMetric[]): BodyMetric[] {
  return [...metrics].sort((a, b) => {
    const d = b.date.localeCompare(a.date);
    if (d !== 0) return d;
    return b.id - a.id;
  });
}

function unwrapMetricsPayload(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const o = payload as Record<string, unknown>;
    for (const key of ["items", "data", "metrics", "results"]) {
      if (Array.isArray(o[key])) return o[key] as unknown[];
    }
  }
  return null;
}

export async function fetchBodyMetrics(): Promise<BodyMetric[]> {
  const url = "/api/health/metrics";
  const res = await fetch(url);
  const rawText = await res.text();
  const contentType = res.headers.get("content-type") ?? "";

  if (!res.ok) {
    throw new Error(rawText || `health/metrics failed (${res.status})`);
  }

  if (!contentType.includes("application/json") && rawText.trimStart().startsWith("<")) {
    throw new Error(
      "health/metrics returned HTML — start backend (port 8000) and use `npm run dev` in design-reference"
    );
  }

  let payload: unknown;
  try {
    payload = rawText ? JSON.parse(rawText) : null;
  } catch (e) {
    console.error("[AIR4 health] fetchBodyMetrics JSON parse error", e);
    throw new Error("health/metrics: invalid JSON response");
  }

  const rows = unwrapMetricsPayload(payload);

  if (!rows) {
    console.error("[AIR4 health] fetchBodyMetrics expected array");
    return [];
  }

  return sortMetricsByDateDesc(
    rows.map((row) => normalizeBodyMetric(row as Record<string, unknown>))
  );
}

export type WorkoutSet = {
  setNumber: number;
  weight: number | null;
  reps: number | null;
};

export type WorkoutExercise = {
  exerciseName: string;
  muscleGroup: string | null;
  sets: WorkoutSet[];
};

export type Workout = {
  id: number;
  date: string;
  type?: string | null;
  duration?: number | null;
  exercises: WorkoutExercise[];
  energy_level?: number | null;
  notes?: string | null;
  source?: string;
  created_at?: string | null;
  total_volume?: number | null;
};

function normalizeWorkoutExercises(raw: unknown): WorkoutExercise[] {
  if (!Array.isArray(raw)) return [];
  const out: WorkoutExercise[] = [];
  raw.forEach((item, idx) => {
    if (!item || typeof item !== "object") return;
    const ex = item as Record<string, unknown>;
    const name = String(ex.exerciseName ?? ex.name ?? "").trim();
    if (!name) return;
    const muscle =
      ex.muscleGroup != null ? String(ex.muscleGroup).trim() || null : null;
    const setsRaw = Array.isArray(ex.sets) ? (ex.sets as unknown[]) : [];
    const sets: WorkoutSet[] = setsRaw
      .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
      .map((s, i) => {
        const setNumber = Number(s.setNumber ?? i + 1) || i + 1;
        const weight = s.weight != null ? Number(s.weight) : null;
        const reps = s.reps != null ? Number(s.reps) : null;
        return {
          setNumber,
          weight: weight != null && Number.isFinite(weight) ? weight : null,
          reps: reps != null && Number.isFinite(reps) ? reps : null,
        };
      });
    out.push({
      exerciseName: name,
      muscleGroup: muscle,
      sets,
    });
    void idx;
  });
  return out;
}

export async function fetchWorkouts(): Promise<Workout[]> {
  const rows = await apiFetch<unknown>("/api/health/workouts");
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const raw = row as Record<string, unknown>;
    const totalVolume =
      raw.total_volume != null ? Number(raw.total_volume) : null;
    return {
      id: Number(raw.id),
      date: String(raw.date ?? ""),
      type: raw.type != null ? String(raw.type) : null,
      duration: raw.duration != null ? Number(raw.duration) : null,
      exercises: normalizeWorkoutExercises(raw.exercises),
      energy_level: raw.energy_level != null ? Number(raw.energy_level) : null,
      notes: raw.notes != null ? String(raw.notes) : null,
      source: raw.source != null ? String(raw.source) : undefined,
      created_at: raw.created_at != null ? String(raw.created_at) : null,
      total_volume:
        totalVolume != null && Number.isFinite(totalVolume) ? totalVolume : null,
    };
  });
}

/** Latest non-null weight from metrics (newest date first). */
export function latestBodyWeight(
  metrics: BodyMetric[]
): { weight: number; date: string } | null {
  for (const m of sortMetricsByDateDesc(metrics)) {
    if (m.weight != null && m.weight > 0) {
      return { weight: m.weight, date: m.date };
    }
  }
  return null;
}

export function latestBodyHeight(
  metrics: BodyMetric[]
): { height: number; date: string } | null {
  for (const m of sortMetricsByDateDesc(metrics)) {
    if (m.height != null && m.height > 0) {
      return { height: m.height, date: m.date };
    }
  }
  return null;
}

/** Date of the most recent row that logged weight and/or height. */
export function latestMetricLogDate(metrics: BodyMetric[]): string | null {
  const row = sortMetricsByDateDesc(metrics).find(
    (m) =>
      (m.weight != null && m.weight > 0) || (m.height != null && m.height > 0)
  );
  return row?.date ?? null;
}

export function bmiFromMetrics(metrics: BodyMetric[]): number | null {
  const w = latestBodyWeight(metrics);
  const h = latestBodyHeight(metrics);
  if (!w || !h) return null;
  const m = h.height / 100;
  return Math.round((w.weight / (m * m)) * 10) / 10;
}

export function hasHealthData(
  metrics: BodyMetric[],
  workouts: Workout[] = []
): boolean {
  if (workouts.length > 0) return true;
  if (!metrics.length) return false;
  return (
    latestBodyWeight(metrics) != null ||
    latestBodyHeight(metrics) != null ||
    metrics.some(
      (m) =>
        (m.weight != null && m.weight > 0) || (m.height != null && m.height > 0)
    )
  );
}

export async function getTransactions(limit = 50): Promise<TransactionsPage> {
  return apiFetch<TransactionsPage>(`/api/transactions?limit=${limit}`);
}

export type Insight = {
  type: string;
  title: string;
  description: string;
  amount_mentioned?: number | null;
};

export async function getInsights(): Promise<Insight[]> {
  return apiFetch<Insight[]>("/api/insights");
}

export type UploadResult = {
  upload_id: number;
  filename: string;
  account_ibans: string[];
  period_start: string | null;
  period_end: string | null;
  total_transactions: number;
  new_transactions: number;
  skipped_duplicates: number;
  categories: Record<string, number>;
};

export type StatementUpload = {
  id: number;
  filename: string;
  account_iban?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  total_transactions: number;
  created_at?: string | null;
};

export type UploadDeleteResult = {
  deleted: boolean;
  transactions_removed: number;
};

export async function getUploads(): Promise<StatementUpload[]> {
  return apiFetch<StatementUpload[]>("/api/uploads");
}

export async function deleteUpload(uploadId: number): Promise<UploadDeleteResult> {
  return apiFetch<UploadDeleteResult>(`/api/uploads/${uploadId}`, { method: "DELETE" });
}

export async function uploadStatement(file: File): Promise<UploadResult> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/api/upload", { method: "POST", body: formData });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let detail = text;
    try {
      const parsed = JSON.parse(text) as { detail?: string };
      detail = parsed.detail ?? text;
    } catch {
      /* use raw text */
    }
    throw new Error(detail || `Upload failed (${res.status})`);
  }
  return res.json() as Promise<UploadResult>;
}

export async function getProjects(): Promise<Project[]> {
  return apiFetch<Project[]>("/api/projects");
}

export async function fetchDilemmas(): Promise<Dilemma[]> {
  return apiFetch<Dilemma[]>("/api/dilemmas");
}

export const getDilemmas = fetchDilemmas;

export type UserProfileSection = {
  name: string | null;
  city: string | null;
  profession: string | null;
  monthly_income: number | null;
  goals: string[];
  context: string | null;
};

export type UserFact = {
  key: string;
  value: string;
  confidence: number;
  updated_at: string | null;
};

export type ProfileStats = {
  total_transactions: number;
  total_events: number;
  facts_count: number;
  member_since: string | null;
};

export type ProfileBundle = {
  profile: UserProfileSection;
  facts: UserFact[];
  stats: ProfileStats;
};

export async function fetchProfile(): Promise<ProfileBundle> {
  return apiFetch<ProfileBundle>("/api/profile");
}

export const getProfile = fetchProfile;

export type LifeEvent = {
  id: number;
  date: string;
  title: string;
  description: string | null;
  domain: string;
  category: string | null;
  importance: number;
  created_at: string | null;
};

export type EventsResponse = {
  events: LifeEvent[];
  total: number;
};

export async function fetchEvents(): Promise<EventsResponse> {
  const data = await apiFetch<EventsResponse>("/api/events");
  return {
    events: data.events ?? [],
    total: data.total ?? 0,
  };
}

export const getEvents = fetchEvents;

export type GoalItem = {
  id: number;
  title: string;
  source: "profile" | "facts" | string;
  key?: string | null;
};

export type GoalsResponse = {
  goals: GoalItem[];
};

export async function fetchGoals(): Promise<GoalsResponse> {
  const data = await apiFetch<GoalsResponse>("/api/goals");
  return { goals: data.goals ?? [] };
}

export const getGoals = fetchGoals;

export type Hypothesis = {
  id: number;
  text: string;
  status: string;
  confidence: number;
  evidence_count: number;
  domains: string[];
  created_at?: string | null;
};

export type HypothesesResponse = {
  hypotheses: Hypothesis[];
};

export type InterviewQuestion = {
  has_question: boolean;
  question?: string | null;
  domain?: string | null;
};

export async function fetchInterviewQuestion(): Promise<InterviewQuestion> {
  const data = await apiFetch<InterviewQuestion>("/api/interview/question");
  return {
    has_question: data.has_question === true,
    question: data.question ?? null,
    domain: data.domain ?? null,
  };
}

export async function submitInterviewAnswer(
  question: string,
  answer: string
): Promise<{ saved: boolean }> {
  const res = await fetch("/api/interview/answer", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, answer }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `interview/answer failed (${res.status})`);
  }
  const data = (await res.json()) as { saved?: boolean };
  return { saved: data.saved === true };
}

export async function fetchHypotheses(): Promise<HypothesesResponse> {
  const data = await apiFetch<HypothesesResponse>("/api/hypotheses");
  return {
    hypotheses: (data.hypotheses ?? []).map((h) => ({
      ...h,
      domains: h.domains ?? [],
      confidence: typeof h.confidence === "number" ? h.confidence : 0.5,
      evidence_count: typeof h.evidence_count === "number" ? h.evidence_count : 0,
    })),
  };
}

function normalizeObservation(raw: Record<string, unknown>): Observation {
  return {
    id: Number(raw.id),
    title: String(raw.title ?? ""),
    body: String(raw.body ?? ""),
    observation_type: String(raw.observation_type ?? "pattern"),
    is_read: raw.is_read === true || raw.is_read === 1,
    created_at: raw.created_at != null ? String(raw.created_at) : null,
  };
}

/** First unread observation, or the first in the list. */
export function pickDisplayObservation(
  observations: Observation[]
): Observation | null {
  if (!observations.length) return null;
  return observations.find((o) => !o.is_read) ?? observations[0];
}

export async function fetchObservations(): Promise<Observation[]> {
  const rows = await apiFetch<unknown>("/api/observations");
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => normalizeObservation(row as Record<string, unknown>));
}

/** @deprecated use fetchObservations */
export const getObservations = fetchObservations;

export type ObservationGenerateResult = {
  generated: number;
  observations: Observation[];
};

export async function generateObservations(): Promise<ObservationGenerateResult> {
  const data = await apiFetch<{
    generated: number;
    observations: Record<string, unknown>[];
  }>("/api/observations/generate", { method: "POST" });
  return {
    generated: data.generated ?? 0,
    observations: (data.observations ?? []).map(normalizeObservation),
  };
}

export function hasFinanceData(summary: Summary | null): boolean {
  if (!summary) return false;
  if (summary.period_start && summary.period_end) return true;
  if (summary.total_spent > 0 || summary.total_income > 0) return true;
  return Object.keys(summary.by_category ?? {}).length > 0;
}

export function topCategory(
  summary: Summary | null
): [string, CategorySummary] | null {
  if (!summary?.by_category) return null;
  const entries = Object.entries(summary.by_category).filter(
    ([key]) => key !== "internal_transfers"
  );
  if (!entries.length) return null;
  return entries.sort((a, b) => b[1].amount - a[1].amount)[0];
}

export function formatEuro(amount: number): string {
  return `€${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatCategoryLabel(key: string): string {
  return key.replace(/_/g, " ");
}
