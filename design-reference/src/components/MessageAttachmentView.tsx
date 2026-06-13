import { FileText } from "lucide-react";
import type { MessageAttachment } from "../types";
import {
  attachmentToDataUrl,
  formatAttachmentSize,
  isImageAttachment,
} from "../lib/chatAttachments";
import { cn } from "../lib/utils";

interface MessageAttachmentViewProps {
  attachment: MessageAttachment;
  /** `compact` thumbnails are used in the narrow side ChatPanel,
   *  `wide` in FullscreenChat where there's more horizontal room. */
  size?: "compact" | "wide";
  /** Class added to the wrapping `<div>` for spacing tweaks. */
  className?: string;
}

/** Render either an image thumbnail (click → open in new tab) or a
 *  file pill (PDF). The base64 is inlined as a `data:` URL so no
 *  network round-trip is needed for previews — fine for the ≤10 MB
 *  payloads we accept on the input. */
export function MessageAttachmentView({
  attachment,
  size = "compact",
  className,
}: MessageAttachmentViewProps) {
  // sessionStorage caches messages with stripped `data` to fit under
  // the 5 MB quota — render a neutral placeholder pill in that gap
  // window before /api/chat/history rehydrates the full payload.
  if (!attachment.data) {
    return (
      <div
        className={cn(
          "inline-flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-[10px] px-3 py-2 text-gray-500",
          className
        )}
      >
        <FileText size={size === "wide" ? 18 : 14} className="text-gray-400" />
        <span className={cn(size === "wide" ? "text-[13px]" : "text-[11px]")}>
          {attachment.name ??
            (isImageAttachment(attachment) ? "Изображение" : "Файл")}
        </span>
      </div>
    );
  }

  const url = attachmentToDataUrl(attachment);
  const sizeLabel = formatAttachmentSize(attachment);

  if (isImageAttachment(attachment)) {
    const dims =
      size === "wide"
        ? "max-h-72 max-w-[28rem]"
        : "max-h-40 max-w-[16rem]";
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn("block", className)}
        title={attachment.name ?? "Открыть в полном размере"}
      >
        <img
          src={url}
          alt={attachment.name ?? "attachment"}
          className={cn(
            "rounded-[10px] border border-gray-200 object-cover",
            dims
          )}
        />
      </a>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      download={attachment.name ?? undefined}
      className={cn(
        "inline-flex items-center gap-2 max-w-full",
        "bg-gray-50 border border-gray-200 rounded-[10px] px-3 py-2",
        "hover:bg-gray-100 transition-colors",
        className
      )}
    >
      <FileText
        size={size === "wide" ? 20 : 16}
        className="shrink-0 text-[#f97316]"
      />
      <div className="flex flex-col min-w-0">
        <span
          className={cn(
            "font-semibold text-gray-800 truncate",
            size === "wide" ? "text-[14px]" : "text-[12px]"
          )}
        >
          {attachment.name ?? "PDF документ"}
        </span>
        <span className="text-[10px] text-gray-500 uppercase tracking-wider">
          PDF · {sizeLabel}
        </span>
      </div>
    </a>
  );
}
