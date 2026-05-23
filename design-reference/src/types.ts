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

export interface MessageAttachment {
  /** Base64 payload (no `data:` URI prefix). */
  data: string;
  /** MIME type: `image/*` (jpeg/png/gif/webp) or `application/pdf`. */
  media_type: string;
  /** Original filename, used as the pill label and PDF display name. */
  name?: string | null;
}

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
  /** Optional image/PDF the user attached. Renders as an inline
   *  thumbnail (image) or a file pill (PDF) inside the bubble. */
  attachment?: MessageAttachment;
}

