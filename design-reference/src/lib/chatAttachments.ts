/**
 * Helpers for the chat-input file picker (image + PDF).
 *
 * Both ChatPanel and FullscreenChat share the same pipeline:
 *   1. file picker → readFileAsAttachment() converts to base64 + mime.
 *   2. pill UI shows name + size and exposes a clear button.
 *   3. on send, the encoded attachment is forwarded via streamChat().
 *
 * Centralizing this keeps validation rules (size, type) and the FE/BE
 * contract (`{data, media_type, name}`) in one place.
 */

import type { MessageAttachment } from "../types";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export const ACCEPTED_ATTACHMENT_MIMES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
] as const;

/** `accept` attribute for the hidden <input type="file">. */
export const ATTACHMENT_ACCEPT = "image/*,application/pdf";

export type AttachmentError =
  | { kind: "too_large"; size: number; max: number }
  | { kind: "unsupported_type"; mime: string }
  | { kind: "read_failed"; message: string };

/** Flat result shape rather than a discriminated union — tsconfig
 *  doesn't enable `strict`, so callers can't reliably narrow on a
 *  `{ ok: true } | { ok: false }` tag. Exactly one of `attachment` /
 *  `error` is set per resolution. */
export type ReadResult = {
  attachment: MessageAttachment | null;
  error: AttachmentError | null;
};

function isAcceptedMime(mime: string): boolean {
  return (ACCEPTED_ATTACHMENT_MIMES as readonly string[]).includes(mime);
}

/** Read a File into a `MessageAttachment` ready to send to the API.
 *
 *  Uses FileReader.readAsDataURL — the only cross-browser reliable way
 *  to base64-encode binary data — and strips the `data:<mime>;base64,`
 *  prefix so the payload matches what the backend expects. */
export function readFileAsAttachment(file: File): Promise<ReadResult> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return Promise.resolve({
      attachment: null,
      error: { kind: "too_large", size: file.size, max: MAX_ATTACHMENT_BYTES },
    });
  }
  const mime = file.type || "";
  if (!isAcceptedMime(mime)) {
    return Promise.resolve({
      attachment: null,
      error: { kind: "unsupported_type", mime },
    });
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      const base64 = comma === -1 ? result : result.slice(comma + 1);
      resolve({
        attachment: {
          data: base64,
          media_type: mime,
          name: file.name || null,
        },
        error: null,
      });
    };
    reader.onerror = () =>
      resolve({
        attachment: null,
        error: {
          kind: "read_failed",
          message: reader.error?.message ?? "FileReader error",
        },
      });
    reader.readAsDataURL(file);
  });
}

/** True for `image/*` mimes that should render as an inline thumbnail. */
export function isImageAttachment(att: MessageAttachment): boolean {
  return att.media_type.startsWith("image/");
}

/** Build a usable `data:` URL from an attachment for `<img src>` / `<a href>`. */
export function attachmentToDataUrl(att: MessageAttachment): string {
  return `data:${att.media_type};base64,${att.data}`;
}

/** Human-readable size in KB / MB for the file pill. */
export function formatAttachmentSize(att: MessageAttachment): string {
  // base64 length × 3/4 ≈ raw bytes (ignoring padding nudges).
  const bytes = Math.floor((att.data.length * 3) / 4);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Single source of truth for the toast/error copy on rejected uploads. */
export function describeAttachmentError(error: AttachmentError): string {
  switch (error.kind) {
    case "too_large":
      return `Файл больше ${Math.round(error.max / (1024 * 1024))} МБ`;
    case "unsupported_type":
      return error.mime
        ? `Тип файла ${error.mime} не поддерживается`
        : "Тип файла не поддерживается";
    case "read_failed":
      return `Не удалось прочитать файл: ${error.message}`;
  }
}
