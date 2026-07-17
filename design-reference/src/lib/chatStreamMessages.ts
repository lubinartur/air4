import type { Message } from "../types";

/** Find the in-flight assistant placeholder (PDF/text streams). */
export function findStreamingAssistantIndex(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.role === "assistant" && m.isStreaming) return i;
  }
  return -1;
}

/** Patch the streaming assistant bubble; no-op if none is in flight. */
export function patchStreamingAssistant(
  prev: Message[],
  patch: (msg: Message) => Message,
): Message[] {
  const idx = findStreamingAssistantIndex(prev);
  if (idx === -1) return prev;
  const next = prev.slice();
  next[idx] = patch(prev[idx]);
  return next;
}
