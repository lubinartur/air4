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
    // Strip base64 attachment payloads before caching — a single 5 MB
    // image would otherwise blow past the ~5 MB sessionStorage quota
    // and silently drop the entire history. Keep the metadata so we
    // can show a stub on instant rehydrate; /api/chat/history will
    // restore the full attachment a moment later on mount.
    const lite = messages.map((m) =>
      m.attachment
        ? {
            ...m,
            attachment: {
              data: "",
              media_type: m.attachment.media_type,
              name: m.attachment.name,
            },
          }
        : m
    );
    sessionStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(lite));
  } catch {
    /* ignore quota errors */
  }
}

export function lastChatMessage(messages: Message[]): Message | null {
  if (!messages.length) return null;
  return messages[messages.length - 1];
}
