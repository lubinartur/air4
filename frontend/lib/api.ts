export type Category =
  | "food_groceries"
  | "food_restaurants"
  | "transport"
  | "entertainment"
  | "health"
  | "subscriptions"
  | "shopping"
  | "transfers"
  | "utilities"
  | "other";

export const CATEGORIES: Category[] = [
  "food_groceries",
  "food_restaurants",
  "transport",
  "entertainment",
  "health",
  "subscriptions",
  "shopping",
  "transfers",
  "utilities",
  "other",
];

export type UploadSummary = {
  upload_id: number;
  filename: string | null;
  account_ibans: string[];
  period_start: string | null;
  period_end: string | null;
  total_transactions: number;
  categories: Record<string, number>;
};

export type Transaction = {
  id: number;
  upload_id: number;
  date: string;
  description: string;
  amount: number;
  currency: string;
  category: string;
  category_confirmed: boolean;
  account_iban?: string | null;
  is_debit: boolean;
  is_internal_transfer: boolean;
  raw_description?: string | null;
  created_at?: string | null;
};

export type TransactionsPage = {
  total: number;
  skip: number;
  limit: number;
  items: Transaction[];
};

export type Summary = {
  upload_id: number | null;
  total_spent: number;
  by_category: { category: string; amount: number; percentage: number }[];
  period_start: string | null;
  period_end: string | null;
  /** When the current upload row was created (import timestamp). */
  created_at?: string | null;
};

export type Insight = {
  type: string;
  title: string;
  description: string;
  amount_mentioned?: number | null;
};

export type LifeEvent = {
  id: number;
  date: string | null;
  title: string;
  description: string;
  category: string;
  source: string;
  created_at?: string | null;
};

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type UserFact = {
  id: number;
  key: string;
  value: string | null;
  source: string;
  created_at?: string | null;
  updated_at?: string | null;
};

export type UserProfile = {
  id: number;
  name: string | null;
  context: string | null;
  city: string | null;
  profession: string | null;
  monthly_income: number | null;
  goals: string | null;
  transport: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type UserProfileUpdatePayload = {
  name: string | null;
  context: string | null;
  city: string | null;
  profession: string | null;
  monthly_income: number | null;
  goals: string | null;
  transport: string | null;
};

export type ProjectStatus = "active" | "paused" | "completed" | "archived";

export type Project = {
  id: number;
  name: string;
  description: string | null;
  status: ProjectStatus;
  started_at: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ProjectLog = {
  id: number;
  project_id: number;
  note: string;
  source: string;
  created_at?: string | null;
};

export type ProjectWithLogs = Project & { logs: ProjectLog[] };

export type HypothesisStatus = "pending" | "confirmed" | "rejected";

export type Hypothesis = {
  id: number;
  text: string;
  status: HypothesisStatus;
  confirmed_at?: string | null;
  rejected_at?: string | null;
  created_at?: string | null;
};

export type Sphere = "finance" | "life" | "projects" | "health";
export type Confidence = "high" | "medium" | "low";

export type CrossSphereInsight = {
  id: number;
  sphere1: Sphere | null;
  sphere2: Sphere | null;
  title: string;
  description: string;
  confidence: Confidence | null;
  created_at?: string | null;
};

export type DilemmaStatus = "open" | "closed";

export type Dilemma = {
  id: number;
  title: string;
  description?: string | null;
  options?: string | null;
  analysis?: string | null;
  recommendation?: string | null;
  status: DilemmaStatus;
  created_at?: string | null;
};

export type InterviewQuestion = { question: string };

export type InterviewAnswer = {
  id: number;
  question: string;
  answer: string;
  created_at?: string | null;
};

export type ObservationType = "pattern" | "anomaly" | "milestone" | "reminder";

export type Observation = {
  id: number;
  title: string;
  body: string;
  observation_type: ObservationType;
  is_read: boolean;
  created_at?: string | null;
};

/** Dispatched on `window` after profile save so the header can refresh. */
export const PROFILE_UPDATED_EVENT = "air4-profile-updated";

export function notifyProfileUpdated(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(PROFILE_UPDATED_EVENT));
  }
}

/** Dispatched when stored user facts change (e.g. chat learned facts, delete on /facts). */
export const FACTS_UPDATED_EVENT = "air4-facts-updated";

export function notifyFactsUpdated(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(FACTS_UPDATED_EVENT));
  }
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(
  /\/$/,
  ""
);

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const body = init?.body;
  const isStringBody = typeof body === "string";
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(isStringBody ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export async function uploadCsv(files: File[]): Promise<UploadSummary> {
  const form = new FormData();
  for (const f of files) form.append("files", f);
  return await apiFetch<UploadSummary>("/api/upload", { method: "POST", body: form });
}

export async function getSummary(uploadId?: number): Promise<Summary> {
  const q = uploadId ? `?upload_id=${encodeURIComponent(String(uploadId))}` : "";
  return await apiFetch<Summary>(`/api/summary${q}`);
}

export async function getInsights(uploadId?: number): Promise<Insight[]> {
  const q = uploadId ? `?upload_id=${encodeURIComponent(String(uploadId))}` : "";
  return await apiFetch<Insight[]>(`/api/insights${q}`);
}

export type ReportResponse = {
  report: string;
};

export async function generateReport(): Promise<ReportResponse> {
  return await apiFetch<ReportResponse>("/api/report", { method: "POST" });
}

export type TimelineUpload = {
  upload_id: number;
  period_start: string | null;
  period_end: string | null;
  total_spent: number;
  by_category: { category: string; amount: number; percentage: number }[];
  transaction_count: number;
};

export type TimelineResponse = {
  uploads: TimelineUpload[];
};

export async function getTimeline(): Promise<TimelineResponse> {
  return await apiFetch<TimelineResponse>("/api/timeline");
}

export type ComparePeriod = TimelineUpload;

export type CompareDiffRow = {
  category: string;
  period1_amount: number;
  period2_amount: number;
  diff: number;
  diff_pct: number;
};

export type CompareResponse = {
  period1: ComparePeriod;
  period2: ComparePeriod;
  diff: {
    total: number;
    total_pct: number;
    by_category: CompareDiffRow[];
  };
};

export async function comparePeriods(
  period1: number,
  period2: number
): Promise<CompareResponse> {
  const q = `?period1=${encodeURIComponent(String(period1))}&period2=${encodeURIComponent(String(period2))}`;
  return await apiFetch<CompareResponse>(`/api/compare${q}`);
}

export async function getTransactions(params?: {
  skip?: number;
  limit?: number;
  category?: string;
  is_debit?: boolean;
  exclude_internal?: boolean;
  upload_id?: number;
}): Promise<TransactionsPage> {
  const p = new URLSearchParams();
  if (params?.skip != null) p.set("skip", String(params.skip));
  if (params?.limit != null) p.set("limit", String(params.limit));
  if (params?.category) p.set("category", params.category);
  if (params?.is_debit != null) p.set("is_debit", String(params.is_debit));
  if (params?.exclude_internal != null)
    p.set("exclude_internal", String(params.exclude_internal));
  if (params?.upload_id != null) p.set("upload_id", String(params.upload_id));
  const q = p.toString() ? `?${p.toString()}` : "";
  return await apiFetch<TransactionsPage>(`/api/transactions${q}`);
}

export async function updateTransactionCategory(
  id: number,
  category: Category
): Promise<Transaction> {
  return await apiFetch<Transaction>(`/api/transactions/${id}/category`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category }),
  });
}

export async function getEvents(category?: string): Promise<LifeEvent[]> {
  const q = category ? `?category=${encodeURIComponent(category)}` : "";
  return await apiFetch<LifeEvent[]>(`/api/events${q}`);
}

export async function deleteEvent(id: number): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/events/${id}`, { method: "DELETE" });
}

export async function getFacts(): Promise<UserFact[]> {
  return await apiFetch<UserFact[]>("/api/facts");
}

export async function deleteFact(id: number): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/facts/${id}`, { method: "DELETE" });
}

export async function getProjects(): Promise<Project[]> {
  return await apiFetch<Project[]>("/api/projects");
}

export async function createProject(body: {
  name: string;
  description?: string | null;
  status?: ProjectStatus;
  started_at?: string | null;
}): Promise<Project> {
  return await apiFetch<Project>("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function updateProject(
  id: number,
  body: {
    name: string;
    description?: string | null;
    status?: ProjectStatus;
    started_at?: string | null;
  }
): Promise<Project> {
  return await apiFetch<Project>(`/api/projects/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function deleteProject(id: number): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/projects/${id}`, { method: "DELETE" });
}

export async function getProject(id: number): Promise<ProjectWithLogs> {
  return await apiFetch<ProjectWithLogs>(`/api/projects/${id}`);
}

export async function addProjectLog(
  projectId: number,
  note: string
): Promise<ProjectLog> {
  return await apiFetch<ProjectLog>(`/api/projects/${projectId}/logs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note }),
  });
}

export async function deleteProjectLog(
  projectId: number,
  logId: number
): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/projects/${projectId}/logs/${logId}`, {
    method: "DELETE",
  });
}

export async function getHypotheses(): Promise<Hypothesis[]> {
  return await apiFetch<Hypothesis[]>("/api/hypotheses");
}

export async function generateHypotheses(): Promise<{
  created: number;
  cooldown_hours_remaining?: number | null;
}> {
  return await apiFetch<{ created: number; cooldown_hours_remaining?: number | null }>(
    "/api/hypotheses/generate",
    { method: "POST" }
  );
}

export async function updateHypothesis(
  id: number,
  status: "confirmed" | "rejected"
): Promise<Hypothesis> {
  return await apiFetch<Hypothesis>(`/api/hypotheses/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
}

export async function deleteHypothesis(id: number): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/hypotheses/${id}`, { method: "DELETE" });
}

export async function getCrossSphereInsights(): Promise<CrossSphereInsight[]> {
  return await apiFetch<CrossSphereInsight[]>("/api/cross-sphere");
}

export async function analyzeCrossSphere(): Promise<{
  created: number;
  cooldown_hours_remaining?: number | null;
}> {
  return await apiFetch<{ created: number; cooldown_hours_remaining?: number | null }>(
    "/api/cross-sphere/analyze",
    { method: "POST" }
  );
}

export async function deleteCrossSphereInsight(id: number): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/cross-sphere/${id}`, { method: "DELETE" });
}

export async function getDilemmas(): Promise<Dilemma[]> {
  return await apiFetch<Dilemma[]>("/api/dilemmas");
}

export async function createDilemma(text: string): Promise<Dilemma> {
  return await apiFetch<Dilemma>("/api/dilemmas", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export async function getDilemma(id: number): Promise<Dilemma> {
  return await apiFetch<Dilemma>(`/api/dilemmas/${id}`);
}

export async function deleteDilemma(id: number): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/dilemmas/${id}`, { method: "DELETE" });
}

export async function getPendingFollowups(): Promise<Dilemma[]> {
  return await apiFetch<Dilemma[]>("/api/dilemmas/pending-followups");
}

export async function submitFollowup(id: number, answer: string): Promise<Dilemma> {
  return await apiFetch<Dilemma>(`/api/dilemmas/${id}/followup`, {
    method: "POST",
    body: JSON.stringify({ answer }),
  });
}

export async function getInterviewQuestions(): Promise<{ questions: InterviewQuestion[] }> {
  return await apiFetch<{ questions: InterviewQuestion[] }>("/api/interview/questions");
}

export async function saveInterviewAnswer(question: string, answer: string): Promise<InterviewAnswer> {
  return await apiFetch<InterviewAnswer>("/api/interview/answers", {
    method: "POST",
    body: JSON.stringify({ question, answer }),
  });
}

export async function getInterviewAnswers(): Promise<InterviewAnswer[]> {
  return await apiFetch<InterviewAnswer[]>("/api/interview/answers");
}

export async function getObservations(): Promise<Observation[]> {
  return await apiFetch<Observation[]>("/api/observations");
}

export async function generateObservations(): Promise<{
  created: number;
  cooldown_days_remaining?: number | null;
}> {
  return await apiFetch<{ created: number; cooldown_days_remaining?: number | null }>(
    "/api/observations/generate",
    { method: "POST" }
  );
}

export async function markObservationRead(id: number): Promise<Observation> {
  return await apiFetch<Observation>(`/api/observations/${id}/read`, { method: "PUT" });
}

export async function deleteObservation(id: number): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/observations/${id}`, { method: "DELETE" });
}

export async function getProfile(): Promise<UserProfile> {
  return await apiFetch<UserProfile>("/api/profile");
}

export async function updateProfile(
  body: UserProfileUpdatePayload
): Promise<UserProfile> {
  return await apiFetch<UserProfile>("/api/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export type ChatResponse = {
  response: string;
  event_saved?: LifeEvent | null;
  facts_saved?: UserFact[];
};

export async function chat(
  message: string,
  history: ChatMessage[],
  opts?: { uploadId?: number; currentPage?: string }
): Promise<ChatResponse> {
  const uploadId = opts?.uploadId;
  const currentPage = opts?.currentPage;
  const q = uploadId ? `?upload_id=${encodeURIComponent(String(uploadId))}` : "";
  return await apiFetch<ChatResponse>(`/api/chat${q}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      history,
      current_page: currentPage ?? null,
    }),
  });
}

export type ChatStreamMeta = {
  event_saved?: LifeEvent | null;
  facts_saved?: UserFact[];
};

export async function chatStream(
  message: string,
  history: ChatMessage[],
  opts: {
    uploadId?: number;
    currentPage?: string;
    signal?: AbortSignal;
    onMeta?: (meta: ChatStreamMeta) => void;
    onDelta?: (text: string) => void;
    onDone?: () => void;
  }
): Promise<void> {
  const { uploadId, currentPage, signal, onMeta, onDelta, onDone } = opts;
  const q = uploadId ? `?upload_id=${encodeURIComponent(String(uploadId))}` : "";
  const res = await fetch(`${API_BASE}/api/chat${q}`, {
    method: "POST",
    headers: {
      Accept: "text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message,
      history,
      current_page: currentPage ?? null,
    }),
    cache: "no-store",
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed (${res.status})`);
  }
  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }
  const decoder = new TextDecoder();
  let buffer = "";
  const dispatchLine = (line: string) => {
    const trimmed = line.replace(/\r$/, "");
    if (!trimmed.startsWith("data: ")) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed.slice(6));
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== "object" || !("type" in parsed)) return;
    const rec = parsed as { type: string };
    if (rec.type === "meta") {
      const m = parsed as {
        type: "meta";
        event_saved?: LifeEvent | null;
        facts_saved?: UserFact[];
      };
      onMeta?.({
        event_saved: m.event_saved,
        facts_saved: m.facts_saved,
      });
    } else if (rec.type === "delta") {
      const d = parsed as { type: "delta"; text?: string };
      onDelta?.(d.text ?? "");
    } else if (rec.type === "done") {
      onDone?.();
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: true });
    }
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const line of parts) {
      dispatchLine(line);
    }
    if (done) break;
  }
  buffer += decoder.decode();
  if (buffer.length > 0) {
    for (const line of buffer.split("\n")) {
      dispatchLine(line);
    }
  }
}

