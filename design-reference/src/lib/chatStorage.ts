import type { Message } from "../types";

const CHAT_STORAGE_KEY = "air4_chat_history";

export function loadChatHistory(): Message[] {
  try {
    const raw = sessionStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Message[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveChatHistory(messages: Message[]): void {
  try {
    sessionStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages));
  } catch {
    /* ignore quota errors */
  }
}

export function lastChatMessage(messages: Message[]): Message | null {
  if (!messages.length) return null;
  return messages[messages.length - 1];
}
