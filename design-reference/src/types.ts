export type Page =
  | "Overview"
  | "Finance"
  | "Health"
  | "Sport"
  | "Projects"
  | "Goals"
  | "Patterns"
  | "Dilemmas"
  | "Memory"
  | "Settings"
  | "Chat"
  | "CSVUpload"
  | "EmptyStates"
  | "Profile"
  | "Toasts";

export interface Message {
  role: "user" | "assistant";
  /** Final / persisted text of the message. Always kept in sync with the
   *  joined `chunks` while streaming, so reloads and saves work the same
   *  whether the message was streamed or not. */
  content: string;
  /** Per-delta tail used only while streaming, so each incoming chunk
   *  can be rendered as its own animated `<span>`. Cleared on completion. */
  chunks?: string[];
  /** True only for the assistant bubble currently receiving SSE deltas.
   *  Drives the per-chunk fade-in + terminal cursor in the chat panels. */
  isStreaming?: boolean;
}

