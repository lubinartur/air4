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
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
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

