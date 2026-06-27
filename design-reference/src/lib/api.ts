export type CategorySummary = {
  amount: number;
  count: number;
};

export type InternalTransferSummary = {
  amount: number;
  count: number;
};

export type OtherIncomingSummary = {
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
  other_incoming?: OtherIncomingSummary;
  days_elapsed?: number;
  days_remaining?: number;
  daily_spend_rate?: number;
  forecast_end_of_cycle?: number;
  burn_rate_days?: number;
};

export type ResolvedGoal = {
  /** Stable identifier — either `user_facts.key` for chat-derived
   *  goals or `profile:<idx>` for goals saved on the user profile. */
  key: string;
  /** Display title. `null` when the underlying goal row was deleted
   *  but the project still references the key; FE shows a degraded
   *  pill with the raw key in that case. */
  title?: string | null;
  source?: "profile" | "facts" | null;
};

export type Project = {
  id: number;
  name: string;
  description?: string | null;
  status: string;
  priority?: number;
  started_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  total_sessions_minutes?: number;
  /** Raw identifiers persisted on the project. Always set (server
   *  returns `[]` when none linked). */
  goal_keys?: string[];
  /** Same identifiers joined with display titles. Same length/order
   *  as `goal_keys`. */
  goals?: ResolvedGoal[];
};

export type ProjectLog = {
  id: number;
  note: string;
  log_type: string;
  duration_minutes: number | null;
  source: string;
  created_at: string | null;
};

export type ActiveSession = {
  started_at: string;
};

export type ProjectDetail = Project & {
  logs: ProjectLog[];
  total_sessions_minutes: number;
  active_session: ActiveSession | null;
};

export type ProjectTodo = {
  id: number;
  project_id: number;
  text: string;
  done: boolean;
  done_at: string | null;
  created_at: string | null;
};

export type Dilemma = {
  id: number;
  title: string;
  description?: string | null;
  options?: string | null;
  analysis?: string | null;
  recommendation?: string | null;
  status: string;
  followup_due?: string | null;
  followup_done?: boolean | number;
  followup_answer?: string | null;
  decision_made?: string | null;
  outcome?: string | null;
  tags?: string[];
  created_at?: string | null;
};

export type DilemmaStats = {
  total: number;
  open: number;
  decided: number;
  closed: number;
  abandoned: number;
  followups_due: number;
  followups_completed: number;
  followup_rate: number;
  top_tags: { tag: string; count: number }[];
};

export type Observation = {
  id: number;
  title: string;
  body: string;
  observation_type: string;
  is_read: boolean;
  created_at?: string | null;
};

/** Spheres the cross-sphere analyzer correlates between. Kept as a
 *  union of the four current values so the FE palette can switch on
 *  it exhaustively, but the backend serves whatever string it has
 *  saved — unknown values render as a neutral gray badge. */
export type CrossSphere = "finance" | "health" | "projects" | "life";

export type CrossSphereInsight = {
  id: number;
  sphere1: CrossSphere | string;
  sphere2: CrossSphere | string;
  title: string;
  description: string;
  /** 0..1. The Patterns card uses three tone bands: <0.6 / 0.6-0.8 /
   *  >0.8 (mirrors the backend phrasing). */
  confidence: number;
  /** Raw rule-layer payload. May be null for older rows; the UI
   *  reads only `title`/`description` today. */
  evidence?: Record<string, unknown> | null;
  is_active: boolean;
  expires_at?: string | null;
  created_at?: string | null;
};

export async function fetchCrossSphereInsights(
  limit = 20
): Promise<CrossSphereInsight[]> {
  const data = await apiFetch<{ insights: CrossSphereInsight[] }>(
    `/api/cross-sphere?limit=${encodeURIComponent(limit)}`
  );
  return data.insights ?? [];
}

export type Transaction = {
  id: number;
  date: string;
  description?: string | null;
  amount: number;
  currency: string;
  category?: string | null;
  category_confirmed?: boolean;
  is_debit: boolean;
};

export const TRANSACTION_CATEGORIES = [
  "food_groceries",
  "food_restaurants",
  "transport",
  "entertainment",
  "health",
  "subscriptions",
  "shopping",
  "transfers",
  "loan_payment",
  "utilities",
  "salary",
  "other",
] as const;

export type TransactionCategory = (typeof TRANSACTION_CATEGORIES)[number];

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

export async function getSummary(
  start?: string | null,
  end?: string | null
): Promise<Summary> {
  if (start && end) {
    const qs = new URLSearchParams({ start, end });
    return apiFetch<Summary>(`/api/summary?${qs.toString()}`);
  }
  return apiFetch<Summary>("/api/summary");
}

export const fetchSummary = getSummary;

export type RecommendationState = "stable" | "attention" | "critical";

export type Recommendation = {
  recommendation: string;
  basis: string;
  state: RecommendationState;
};

export type RecommendationDomain = "finance" | "projects" | "health";

export type DomainRecommendation = {
  domain: RecommendationDomain;
  title: string;
  summary: string;
  action: string;
  generated_at: string;
};

export type DomainRecommendations = {
  finance: DomainRecommendation;
  projects: DomainRecommendation;
  health: DomainRecommendation;
};

export type ChatAgent = RecommendationDomain;

export type ChatLaunchRequest = {
  message: string;
  agent?: ChatAgent;
  autoSend?: boolean;
};

/** AIR4's single "what to do now" recommendation for the Overview. */
export async function fetchRecommendation(): Promise<Recommendation> {
  return apiFetch<Recommendation>("/api/air4/recommendation");
}

/** Three domain recommendations for the Overview AIRCH Intelligence block. */
export async function fetchDomainRecommendations(): Promise<DomainRecommendations> {
  return apiFetch<DomainRecommendations>("/api/air4/recommendations");
}

/** Summary for Overview KPIs/chart: latest cycle that has transactions. */
export async function fetchOverviewSummary(): Promise<Summary> {
  const cycles = await fetchFinanceCycles();
  const range = cycles.latest_with_data ?? cycles.active;
  return getSummary(range.start, range.end);
}

export type CycleRange = {
  start: string;
  end: string;
};

export type FinanceCycles = {
  active: CycleRange;
  latest_with_data: CycleRange | null;
  earliest_with_data: CycleRange | null;
};

export async function fetchFinanceCycles(): Promise<FinanceCycles> {
  return apiFetch<FinanceCycles>("/api/finance/cycles");
}

export type FinanceSubscription = {
  id: number;
  name: string;
  amount: number | null;
  currency: string;
  billing_day: number | null;
  category: string;
  is_active: boolean;
  source: string;
  created_at: string | null;
  updated_at: string | null;
};

export type SubscriptionInput = {
  name: string;
  amount?: number | null;
  currency?: string;
  billing_day?: number | null;
  category?: string;
};

export type SubscriptionUpdate = Partial<SubscriptionInput> & {
  is_active?: boolean;
};

export type SubscriptionsResponse = {
  subscriptions: FinanceSubscription[];
};

export type FinanceObligation = {
  id: number;
  name: string;
  total_amount: number | null;
  remaining_amount: number | null;
  monthly_payment: number | null;
  interest_rate: number | null;
  due_date: string | null;
  category: string;
  is_active: boolean;
  source: string;
  created_at: string | null;
  updated_at: string | null;
};

export type ObligationInput = {
  name: string;
  total_amount?: number | null;
  remaining_amount?: number | null;
  monthly_payment?: number | null;
  interest_rate?: number | null;
  due_date?: string | null;
  category?: string;
};

export type ObligationUpdate = Partial<ObligationInput> & {
  is_active?: boolean;
};

export type ObligationsResponse = {
  obligations: FinanceObligation[];
};

export type MonthlyFixed = {
  subscriptions_total: number;
  obligations_total: number;
  fixed_total: number;
  subscriptions_count: number;
  obligations_count: number;
};

export type RecurringUpdate = {
  type: "subscription" | "obligation";
  id: number;
  name: string;
  action: "created" | "updated" | "deleted";
  field?: "amount" | "monthly_payment";
  old_value?: number | null;
  new_value?: number;
  currency?: string;
};

export type ChatResponseMeta = {
  recurring_updated?: RecurringUpdate[];
};

/** Image / PDF uploaded with a chat message. Used both for outgoing
 *  requests (FE → BE) and to render attachments coming back from
 *  `/api/chat/history`. `data` is plain base64 (no data: URI prefix);
 *  the UI prepends the prefix when rendering `<img>` thumbnails. */
export type ChatAttachment = {
  data: string;
  media_type: string;
  name?: string | null;
};

export type ChatStreamCallbacks = {
  /** Fired for each incremental token/chunk. */
  onDelta?: (text: string) => void;
  /** Fired once when the backend emits its post-LLM metadata. */
  onMeta?: (meta: ChatResponseMeta) => void;
  /** Fired if the backend or transport reports an error mid-stream. */
  onError?: (message: string) => void;
};

/**
 * POST /api/chat with SSE streaming.
 *
 * Resolves with the accumulated assistant text once the stream finishes.
 * Falls back to a single full-text `onDelta` if the response isn't an
 * event stream (e.g. the dev proxy decided to buffer).
 */
export async function streamChat(
  body: {
    message: string;
    history: Array<{ role: string; content: string }>;
    current_page?: string | null;
    surface?: string | null;
    agent?: ChatAgent | null;
    /** Optional file payload. When set, the backend forwards it to
     *  Claude as either an image or document content block. */
    file_data?: string;
    file_type?: string;
    file_name?: string;
  },
  callbacks: ChatStreamCallbacks = {},
  signal?: AbortSignal
): Promise<string> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    let detail: unknown = null;
    try {
      detail = await response.json();
    } catch {
      detail = await response.text().catch(() => "");
    }
    const message =
      (detail as { error?: string; detail?: string })?.error ??
      (detail as { detail?: string })?.detail ??
      `Chat failed (${response.status})`;
    callbacks.onError?.(message);
    throw new Error(message);
  }

  const contentType = response.headers.get("content-type") ?? "";

  // Non-stream fallback — render the full payload as one delta so the
  // caller's append-to-last-message logic still works.
  if (!contentType.includes("text/event-stream") || !response.body) {
    const data = (await response.json()) as Record<string, unknown> & {
      content?: string;
      response?: string;
      error?: string;
    };
    if (data?.error) {
      callbacks.onError?.(data.error);
      throw new Error(data.error);
    }
    const text = String(data.content ?? data.response ?? "");
    if (text) callbacks.onDelta?.(text);
    callbacks.onMeta?.(data as ChatResponseMeta);
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let assembled = "";

  // SSE frames are separated by a blank line. Each frame is one or more
  // `data: <payload>` lines; payloads are JSON in our protocol.
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let frameEnd = buffer.indexOf("\n\n");
    while (frameEnd !== -1) {
      const frame = buffer.slice(0, frameEnd);
      buffer = buffer.slice(frameEnd + 2);
      frameEnd = buffer.indexOf("\n\n");

      const dataLines = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart());
      if (dataLines.length === 0) continue;

      let event: { type?: string; text?: string } & ChatResponseMeta;
      try {
        event = JSON.parse(dataLines.join("\n"));
      } catch {
        continue;
      }

      if (event.type === "delta") {
        const text = String(event.text ?? "");
        if (text) {
          assembled += text;
          callbacks.onDelta?.(text);
        }
      } else if (event.type === "meta") {
        callbacks.onMeta?.(event);
      } else if (event.type === "error") {
        const msg = String(event.text ?? "stream error");
        callbacks.onError?.(msg);
      }
      // 'done' is just a terminator; reader will return done shortly after.
    }
  }

  return assembled;
}

export type ChatHistoryMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  page: string | null;
  created_at: string | null;
  attachment?: ChatAttachment | null;
};

export type ChatHistoryResponse = {
  messages: ChatHistoryMessage[];
};

export async function fetchChatHistory(
  limit = 50
): Promise<ChatHistoryResponse> {
  const safe = Math.max(1, Math.min(500, Math.trunc(limit)));
  return apiFetch<ChatHistoryResponse>(`/api/chat/history?limit=${safe}`);
}

export type FeedItemType =
  | "transaction"
  | "subscription"
  | "upload"
  | "project_log"
  | "event"
  | "observation";

export type FeedItem = {
  type: FeedItemType;
  title: string;
  subtitle: string | null;
  amount: number | null;
  currency: string | null;
  icon: string | null;
  created_at: string;
};

export type FeedResponse = {
  items: FeedItem[];
};

export async function fetchFeed(limit = 30): Promise<FeedResponse> {
  const safe = Math.max(1, Math.min(200, Math.trunc(limit)));
  return apiFetch<FeedResponse>(`/api/feed?limit=${safe}`);
}

async function jsonRequest<T>(
  method: "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown
): Promise<T> {
  return apiFetch<T>(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export async function fetchSubscriptions(): Promise<SubscriptionsResponse> {
  const data = await apiFetch<SubscriptionsResponse>("/api/finance/subscriptions");
  return { subscriptions: data.subscriptions ?? [] };
}

export async function createSubscription(
  payload: SubscriptionInput
): Promise<FinanceSubscription> {
  return jsonRequest<FinanceSubscription>("POST", "/api/finance/subscriptions", payload);
}

export async function updateSubscription(
  id: number,
  payload: SubscriptionUpdate
): Promise<FinanceSubscription> {
  return jsonRequest<FinanceSubscription>(
    "PUT",
    `/api/finance/subscriptions/${id}`,
    payload
  );
}

export async function deleteSubscription(id: number): Promise<{ deleted: boolean; id: number }> {
  return jsonRequest<{ deleted: boolean; id: number }>(
    "DELETE",
    `/api/finance/subscriptions/${id}`
  );
}

export async function fetchObligations(): Promise<ObligationsResponse> {
  const data = await apiFetch<ObligationsResponse>("/api/finance/obligations");
  return { obligations: data.obligations ?? [] };
}

export async function createObligation(
  payload: ObligationInput
): Promise<FinanceObligation> {
  return jsonRequest<FinanceObligation>("POST", "/api/finance/obligations", payload);
}

export async function updateObligation(
  id: number,
  payload: ObligationUpdate
): Promise<FinanceObligation> {
  return jsonRequest<FinanceObligation>(
    "PUT",
    `/api/finance/obligations/${id}`,
    payload
  );
}

export async function deleteObligation(id: number): Promise<{ deleted: boolean; id: number }> {
  return jsonRequest<{ deleted: boolean; id: number }>(
    "DELETE",
    `/api/finance/obligations/${id}`
  );
}

export async function fetchMonthlyFixed(): Promise<MonthlyFixed> {
  return apiFetch<MonthlyFixed>("/api/finance/monthly-fixed");
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

export type HealthMarkerStatus = "HIGH" | "LOW" | "NORMAL" | string;

export type HealthMarker = {
  id: number;
  marker_name: string;
  value: number;
  unit: string | null;
  reference_min: number | null;
  reference_max: number | null;
  status: HealthMarkerStatus;
  source: string;
  created_at: string | null;
};

export type HealthCheckupGroup = {
  date: string;
  markers: HealthMarker[];
};

export async function fetchHealthCheckups(): Promise<HealthCheckupGroup[]> {
  const data = await apiFetch<{ checkups?: HealthCheckupGroup[] }>(
    "/api/health/checkups"
  );
  return (data.checkups ?? []).map((group) => ({
    date: String(group.date ?? ""),
    markers: (group.markers ?? []).map((m) => ({
      id: Number(m.id),
      marker_name: String(m.marker_name ?? ""),
      value: Number(m.value),
      unit: m.unit != null ? String(m.unit) : null,
      reference_min:
        m.reference_min != null ? Number(m.reference_min) : null,
      reference_max:
        m.reference_max != null ? Number(m.reference_max) : null,
      status: String(m.status ?? "NORMAL").toUpperCase(),
      source: String(m.source ?? "manual"),
      created_at: m.created_at != null ? String(m.created_at) : null,
    })),
  }));
}

export type HealthMarkerHistoryPoint = {
  date: string;
  value: number;
  unit: string | null;
  status: HealthMarkerStatus;
  reference_min: number | null;
  reference_max: number | null;
};

export type HealthMarkerHistory = {
  marker_name: string;
  points: HealthMarkerHistoryPoint[];
};

/** Fetch all historical values for a single biomarker (oldest first).
 *
 *  Matches case-insensitively on the backend, so passing the exact
 *  string displayed in the UI is sufficient — earlier checkups with
 *  drifted casing/spacing still land in the same trend. Returns an
 *  empty `points` array on 404 so callers don't have to special-case
 *  the "no history yet" state — they only need to handle non-404
 *  network/parse failures.
 *
 *  Uses raw `fetch` (not `apiFetch`) so we can branch on status
 *  without sniffing the error message — the body is a FastAPI JSON
 *  detail, not a stringified status code. */
export async function fetchMarkerHistory(
  markerName: string
): Promise<HealthMarkerHistory> {
  const encoded = encodeURIComponent(markerName);
  const res = await fetch(`/api/health/markers/${encoded}/history`);
  if (res.status === 404) {
    return { marker_name: markerName, points: [] };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `marker history failed (${res.status})`);
  }
  const data = (await res.json()) as {
    marker_name?: string;
    points?: HealthMarkerHistoryPoint[];
  };
  return {
    marker_name: String(data.marker_name ?? markerName),
    points: (data.points ?? []).map((p) => ({
      date: String(p.date ?? ""),
      value: Number(p.value),
      unit: p.unit != null ? String(p.unit) : null,
      status: String(p.status ?? "NORMAL").toUpperCase(),
      reference_min:
        p.reference_min != null ? Number(p.reference_min) : null,
      reference_max:
        p.reference_max != null ? Number(p.reference_max) : null,
    })),
  };
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

export type BodyMetricInput = {
  weight?: number | null;
  height?: number | null;
  body_fat?: number | null;
  notes?: string | null;
  date?: string | null;
};

export async function logBodyMetric(input: BodyMetricInput): Promise<BodyMetric> {
  const raw = await jsonPost<Record<string, unknown>>(
    "/api/health/metrics",
    input
  );
  return normalizeBodyMetric(raw);
}

export type WorkoutInput = {
  date?: string | null;
  type?: string | null;
  duration?: number | null;
  notes?: string | null;
  energy_level?: number | null;
  exercises?: WorkoutExercise[];
};

export async function logWorkout(input: WorkoutInput): Promise<Workout> {
  const payload: Record<string, unknown> = {
    date: input.date ?? null,
    type: input.type ?? null,
    duration: input.duration ?? null,
    notes: input.notes ?? null,
    energy_level: input.energy_level ?? null,
    exercises: input.exercises ?? [],
  };
  const raw = await jsonPost<Record<string, unknown>>(
    "/api/health/workouts",
    payload
  );
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

export type GetTransactionsParams = {
  limit?: number;
  skip?: number;
  category?: string;
  start?: string;
  end?: string;
};

export async function getTransactionsRange(
  params: GetTransactionsParams = {}
): Promise<TransactionsPage> {
  const search = new URLSearchParams();
  if (params.limit != null) search.set("limit", String(params.limit));
  if (params.skip != null) search.set("skip", String(params.skip));
  if (params.category) search.set("category", params.category);
  if (params.start) search.set("start", params.start);
  if (params.end) search.set("end", params.end);
  const qs = search.toString();
  return apiFetch<TransactionsPage>(
    `/api/transactions${qs ? `?${qs}` : ""}`
  );
}

/** PUT a category for a transaction.
 *  Accepts both canonical `TransactionCategory` values and arbitrary
 *  custom slugs created from the review screen — the backend validator
 *  enforces format only ([a-z0-9_-], 1–64 chars). */
export async function updateTransactionCategory(
  transactionId: number,
  category: TransactionCategory | string
): Promise<Transaction> {
  const slug = String(category).trim().toLowerCase();
  if (!slug) {
    throw new Error("Category slug is required");
  }
  return apiFetch<Transaction>(
    `/api/transactions/${transactionId}/category`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: slug }),
    }
  );
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

export const fetchProjects = getProjects;

export type ProjectCreateInput = {
  name: string;
  description?: string | null;
  status?: string;
  priority?: number;
};

export async function createProject(
  input: ProjectCreateInput
): Promise<Project> {
  return jsonPost<Project>("/api/projects", {
    name: input.name,
    description: input.description ?? null,
    status: (input.status ?? "active").toLowerCase(),
    priority: input.priority ?? 2,
  });
}

export async function fetchProject(id: number): Promise<ProjectDetail> {
  const data = await apiFetch<ProjectDetail>(`/api/projects/${id}`);
  return {
    ...data,
    logs: data.logs ?? [],
    total_sessions_minutes: data.total_sessions_minutes ?? 0,
    active_session: data.active_session ?? null,
    goal_keys: data.goal_keys ?? [],
    goals: data.goals ?? [],
  };
}

/** Replace a project's linked goal keys. Pass an empty array to
 *  clear every link. Returns the freshly resolved project so the
 *  caller can render new pills without a second fetch. */
export async function updateProjectGoals(
  id: number,
  goalKeys: string[]
): Promise<Project> {
  return jsonPut<Project>(`/api/projects/${id}/goals`, {
    goal_keys: goalKeys,
  });
}

async function jsonPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

async function jsonPut<T>(path: string, body: unknown = {}): Promise<T> {
  const res = await fetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export async function addProjectLog(
  id: number,
  note: string,
  log_type: string = "update"
): Promise<ProjectLog> {
  return jsonPost<ProjectLog>(`/api/projects/${id}/logs`, { note, log_type });
}

export async function startSession(
  id: number
): Promise<{ started_at: string; log_id: number }> {
  return jsonPost(`/api/projects/${id}/sessions/start`, {});
}

export async function stopSession(
  id: number,
  label: string
): Promise<ProjectLog> {
  return jsonPost<ProjectLog>(`/api/projects/${id}/sessions/stop`, { label });
}

export async function fetchTodos(id: number): Promise<ProjectTodo[]> {
  const data = await apiFetch<{ todos?: ProjectTodo[] }>(`/api/projects/${id}/todos`);
  return data.todos ?? [];
}

export async function addTodo(id: number, text: string): Promise<ProjectTodo> {
  return jsonPost<ProjectTodo>(`/api/projects/${id}/todos`, { text });
}

export async function toggleTodo(todoId: number): Promise<ProjectTodo> {
  return jsonPut<ProjectTodo>(`/api/projects/todos/${todoId}`);
}

export async function fetchDilemmas(): Promise<Dilemma[]> {
  return apiFetch<Dilemma[]>("/api/dilemmas");
}

export const getDilemmas = fetchDilemmas;

export async function getPendingFollowups(): Promise<Dilemma[]> {
  return apiFetch<Dilemma[]>("/api/dilemmas/pending-followups");
}

export async function getDilemmaStats(): Promise<DilemmaStats> {
  return apiFetch<DilemmaStats>("/api/dilemmas/stats");
}

export async function submitFollowupAnswer(
  dilemmaId: number,
  answer: string,
): Promise<Dilemma> {
  return jsonPost<Dilemma>(`/api/dilemmas/${dilemmaId}/followup-answer`, {
    answer,
  });
}

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
  // Amount-first, symbol-after with a non-breaking space — matches the
  // European convention ("15.01 €") and the design spec for the
  // Finance page. NBSP keeps the number and € together if the parent
  // container word-wraps. The grouping locale stays en-US (dot decimal,
  // comma thousands) because the rest of the UI's number formatting
  // assumes that style.
  return `${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}\u00A0€`;
}

// Categories that have a curated localized label. Keep this list small —
// most categories use the auto-generated "snake_case → Title Case" fallback
// so custom user categories (e.g. "pet_care" → "Pet Care") still render
// reasonably without needing a per-key override.
const CATEGORY_LABEL_OVERRIDES: Record<string, string> = {
  loan_payment: "Выплата кредита",
};

export function formatCategoryLabel(key: string): string {
  const override = CATEGORY_LABEL_OVERRIDES[key];
  if (override !== undefined) return override;
  // snake_case → "Title Case". The regex Title-cases the first letter of
  // every word; Unicode (Cyrillic / accented) characters fall through
  // unchanged since they don't match `\w` — overrides above are the
  // right place for those labels.
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export type ObserverStatus = {
  enabled: boolean;
  running: boolean;
};

export type ObserverEvent = {
  id: number;
  app_name: string;
  window_title: string | null;
  duration_seconds: number;
  domain: string | null;
  project_hint: string | null;
  observed_at: string | null;
};

export type ObserverTodayByApp = {
  app: string;
  window: string;
  minutes: number;
  project_hint: string;
};

export type ObserverToday = {
  date: string;
  total_minutes: number;
  by_domain: Record<
    string,
    { minutes: number; events: ObserverEvent[] }
  >;
  by_app: ObserverTodayByApp[];
  recent: ObserverEvent[];
};

export async function fetchObserverStatus(): Promise<ObserverStatus> {
  const res = await fetch("/api/observer/status");
  if (!res.ok) throw new Error("Failed to load observer status");
  return res.json();
}

export async function toggleObserver(enabled: boolean): Promise<ObserverStatus> {
  const res = await fetch("/api/observer/toggle", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error("Failed to toggle observer");
  return res.json();
}

export async function fetchObserverToday(): Promise<ObserverToday> {
  const res = await fetch("/api/observer/today");
  if (!res.ok) throw new Error("Failed to load observer today");
  return res.json();
}

export async function fetchObserverLog(
  days = 7,
  limit = 50
): Promise<ObserverEvent[]> {
  const res = await fetch(
    `/api/observer/log?days=${days}&limit=${limit}`
  );
  if (!res.ok) throw new Error("Failed to load observer log");
  return res.json();
}
