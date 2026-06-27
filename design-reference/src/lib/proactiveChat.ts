import type { ChatHistoryMessage } from "./api";
import type { Message } from "../types";

const BRIEF_SEEN_KEY = "air4_proactive_brief_seen";
const LAST_USER_MSG_KEY = "air4_last_user_message_at";
const LAST_NUDGE_KEY = "air4_observer_nudge_shown";

export function localDateKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function markBriefSeen(content: string): void {
  try {
    sessionStorage.setItem(
      BRIEF_SEEN_KEY,
      JSON.stringify({ date: localDateKey(), content }),
    );
  } catch {
    /* storage unavailable */
  }
}

export function hasSeenBrief(content: string): boolean {
  try {
    const raw = sessionStorage.getItem(BRIEF_SEEN_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { date?: string; content?: string };
    return parsed.date === localDateKey() && parsed.content === content;
  } catch {
    return false;
  }
}

export function recordUserMessage(at = Date.now()): void {
  try {
    localStorage.setItem(LAST_USER_MSG_KEY, String(at));
  } catch {
    /* storage unavailable */
  }
}

export function syncLastUserActivityFromHistory(
  messages: ChatHistoryMessage[],
): void {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const row = messages[i];
    if (row.role !== "user" || !row.created_at) continue;
    const ts = Date.parse(row.created_at);
    if (Number.isFinite(ts)) {
      recordUserMessage(ts);
    }
    return;
  }
}

export function minutesSinceLastUserMessage(): number {
  try {
    const raw = localStorage.getItem(LAST_USER_MSG_KEY);
    if (!raw) return Infinity;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return Infinity;
    return (Date.now() - ts) / 60_000;
  } catch {
    return Infinity;
  }
}

export function hasShownNudge(content: string): boolean {
  try {
    const raw = sessionStorage.getItem(LAST_NUDGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { content?: string };
    return parsed.content === content;
  } catch {
    return false;
  }
}

export function markNudgeShown(content: string): void {
  try {
    sessionStorage.setItem(
      LAST_NUDGE_KEY,
      JSON.stringify({ content, at: Date.now() }),
    );
  } catch {
    /* storage unavailable */
  }
}

export function appendAssistantIfNew(
  prev: Message[],
  content: string,
): Message[] {
  if (
    prev.some((m) => m.role === "assistant" && m.content.trim() === content.trim())
  ) {
    return prev;
  }
  return [...prev, { role: "assistant", content }];
}
