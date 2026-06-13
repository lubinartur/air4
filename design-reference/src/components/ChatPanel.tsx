import { useState, useRef, useEffect, useMemo, type ChangeEvent } from "react";
import { Maximize2, Paperclip, RefreshCw, Send, X } from "lucide-react";
import { Message, MessageAttachment, Page } from "../types";
import { cn } from "../lib/utils";
import ReactMarkdown from "react-markdown";
import {
  fetchChatHistory,
  fetchInterviewQuestion,
  streamChat,
  submitInterviewAnswer,
  type ChatResponseMeta,
  type Observation,
} from "../lib/api";
import { loadChatHistory, saveChatHistory } from "../lib/chatStorage";
import {
  ATTACHMENT_ACCEPT,
  describeAttachmentError,
  formatAttachmentSize,
  isImageAttachment,
  readFileAsAttachment,
} from "../lib/chatAttachments";
import { MessageAttachmentView } from "./MessageAttachmentView";
import { EnergyStateDropdown } from "./EnergyStateDropdown";

interface ChatPanelProps {
  currentPage: Page;
  observation?: Observation | null;
  observationsRefreshing?: boolean;
  onRefreshObservations?: () => void;
  onMessageSent?: (meta?: ChatResponseMeta) => void;
  pendingMessage?: string | null;
  onPendingMessageConsumed?: () => void;
  onExpand?: () => void;
}

export function ChatPanel({
  currentPage,
  observation = null,
  observationsRefreshing = false,
  onRefreshObservations,
  onMessageSent,
  pendingMessage,
  onPendingMessageConsumed,
  onExpand,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>(() => loadChatHistory());
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [interviewQuestion, setInterviewQuestion] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<MessageAttachment | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    saveChatHistory(messages);
  }, [messages]);

  /** Hydrate the chat thread from the backend chat_messages table. Falls back
   *  to whatever loadChatHistory() already returned from sessionStorage if
   *  the request fails or the server has no rows yet. */
  useEffect(() => {
    let cancelled = false;
    void fetchChatHistory(50)
      .then((res) => {
        if (cancelled) return;
        const remote: Message[] = res.messages
          .filter(
            (m) =>
              (m.role === "user" || m.role === "assistant") &&
              m.content.trim() !== ""
          )
          .map((m) => ({
            role: m.role,
            content: m.content,
            // Carry the attachment forward so reloads show the image
            // thumbnail / PDF pill the user originally sent.
            attachment: m.attachment ?? undefined,
          }));
        if (remote.length > 0) setMessages(remote);
      })
      .catch(() => {
        /* keep localStorage fallback */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  useEffect(() => {
    if (!pendingMessage) return;
    setInput(pendingMessage);
    onPendingMessageConsumed?.();
  }, [pendingMessage, onPendingMessageConsumed]);

  useEffect(() => {
    let cancelled = false;
    void fetchInterviewQuestion()
      .then((res) => {
        if (cancelled) return;
        if (res.has_question && res.question) {
          setInterviewQuestion(res.question);
        } else {
          setInterviewQuestion(null);
        }
      })
      .catch(() => {
        /* interview is optional */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const previewBubble = useMemo((): Message | null => {
    if (messages.length > 0 || interviewQuestion) return null;
    const body = observation?.body?.trim();
    if (!body) return null;
    return { role: "assistant", content: body };
  }, [messages.length, interviewQuestion, observation?.body]);

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input immediately so the same file can be re-selected
    // after a clear → click cycle. Without this, browsers suppress the
    // change event on identical selection.
    e.target.value = "";
    if (!file) return;
    setAttachmentError(null);
    const result = await readFileAsAttachment(file);
    if (result.attachment) {
      setAttachment(result.attachment);
    } else if (result.error) {
      setAttachmentError(describeAttachmentError(result.error));
    }
  };

  const handleClearAttachment = () => {
    setAttachment(null);
    setAttachmentError(null);
  };

  const handleSend = async () => {
    // Allow send when there is either text OR a file (file-only turns
    // get a placeholder caption "(см. вложение)" on the backend).
    if (isLoading) return;
    if (!input.trim() && !attachment) return;

    const text = input.trim();
    const pendingInterview = interviewQuestion;
    const outgoingAttachment = attachment;
    const userMessage: Message = {
      role: "user",
      content: text,
      attachment: outgoingAttachment ?? undefined,
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setAttachment(null);
    setAttachmentError(null);
    setIsLoading(true);

    if (pendingInterview) {
      setInterviewQuestion(null);
      try {
        await Promise.race([
          submitInterviewAnswer(pendingInterview, text),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("interview answer timeout (5s)")),
              5000
            )
          ),
        ]);
      } catch (error) {
        console.error("Interview answer save skipped:", error);
      }
    }

    // Pre-allocate an empty assistant bubble (in streaming mode) so deltas
    // can append into it in place. `historyBeforeAssistant` is the
    // LLM-visible context (no placeholder), captured before the empty
    // bubble is pushed.
    const historyBeforeAssistant = messages;
    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: "", chunks: [], isStreaming: true },
    ]);

    let receivedAny = false;
    let meta: ChatResponseMeta | undefined;

    const finalizeLast = (transform: (last: Message) => Message) =>
      setMessages((prev) => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        if (last.role !== "assistant") return prev;
        const next = prev.slice(0, -1);
        next.push(transform(last));
        return next;
      });

    try {
      await streamChat(
        {
          message: text,
          history: historyBeforeAssistant,
          current_page: currentPage,
          ...(outgoingAttachment
            ? {
                file_data: outgoingAttachment.data,
                file_type: outgoingAttachment.media_type,
                file_name: outgoingAttachment.name ?? undefined,
              }
            : {}),
        },
        {
          onDelta: (delta) => {
            receivedAny = true;
            // Append the delta as its own chunk so the renderer can
            // wrap it in an animated span. `content` is kept in sync
            // for persistence + the post-stream markdown render.
            setMessages((prev) => {
              if (prev.length === 0) return prev;
              const last = prev[prev.length - 1];
              if (last.role !== "assistant") return prev;
              const next = prev.slice(0, -1);
              next.push({
                ...last,
                content: last.content + delta,
                chunks: [...(last.chunks ?? []), delta],
                isStreaming: true,
              });
              return next;
            });
          },
          onMeta: (incoming) => {
            meta = incoming;
          },
          onError: (msg) => {
            console.error("Chat stream error:", msg);
          },
        }
      );

      if (!receivedAny) {
        finalizeLast((last) =>
          last.content
            ? { ...last, isStreaming: false, chunks: undefined }
            : {
                ...last,
                content: "(пустой ответ)",
                isStreaming: false,
                chunks: undefined,
              }
        );
      } else {
        // Clear streaming state so the bubble switches from per-chunk
        // animated spans to its final ReactMarkdown render.
        finalizeLast((last) => ({
          ...last,
          isStreaming: false,
          chunks: undefined,
        }));
      }

      onMessageSent?.({ recurring_updated: meta?.recurring_updated });
    } catch (error) {
      console.error("Chat Error:", error);
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        const failureBubble: Message = {
          role: "assistant",
          content: "AIR4 не в сети. Соединение не установлено.",
          isStreaming: false,
        };
        if (!last || last.role !== "assistant" || last.content) {
          return [...prev, failureBubble];
        }
        return [...prev.slice(0, -1), failureBubble];
      });
    } finally {
      setIsLoading(false);
    }
  };

  const renderBubble = (msg: Message, key: string | number) => (
    <div
      key={key}
      className={cn("flex flex-col gap-1.5", msg.role === "user" ? "items-end" : "items-start")}
    >
      {msg.role === "assistant" && (
        <span className="text-[11px] font-bold text-[#9ca3af] uppercase tracking-wider ml-1">
          AIR4
        </span>
      )}
      <div
        className={cn(
          "max-w-[90%] px-4 py-2.5 rounded-[12px] text-[14px] leading-relaxed shadow-sm transition-all",
          msg.role === "user"
            ? "bg-[#f3f4f6] text-[#374151]"
            : "bg-white border-l-[4px] border-l-indigo-600 text-[#111827]"
        )}
      >
        {msg.attachment && (
          <MessageAttachmentView
            attachment={msg.attachment}
            size="compact"
            className={msg.content ? "mb-2" : undefined}
          />
        )}
        {msg.role === "assistant" && msg.isStreaming && msg.chunks ? (
          // Streaming render: each SSE delta is its own <span> so the
          // CSS fade-in keyframe runs once per chunk as it lands.
          <div className="break-words whitespace-pre-wrap">
            {msg.chunks.map((chunk, i) => (
              <span key={i} className="air4-fade-chunk">
                {chunk}
              </span>
            ))}
          </div>
        ) : msg.content ? (
          <div className="prose prose-sm prose-slate break-words">
            <ReactMarkdown>{msg.content}</ReactMarkdown>
          </div>
        ) : null}
      </div>
    </div>
  );

  return (
    <aside className="w-80 h-screen bg-chat border-l border-gray-100 shadow-[-10px_0_30px_rgba(0,0,0,0.02)] flex flex-col shrink-0">
      <header className="p-5 border-b border-gray-50 flex items-center justify-between gap-3">
        <EnergyStateDropdown className="relative shrink-0 min-w-0" />
        <div className="shrink-0 flex items-center gap-3">
          {onRefreshObservations && (
            <button
              type="button"
              onClick={onRefreshObservations}
              disabled={observationsRefreshing}
              className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[#9ca3af] hover:text-indigo-600 disabled:opacity-40 transition-colors"
              title="Сгенерировать наблюдения"
            >
              <RefreshCw
                size={12}
                className={cn(observationsRefreshing && "animate-spin")}
              />
              Обновить
            </button>
          )}
          {onExpand && (
            <button
              type="button"
              onClick={onExpand}
              className="flex items-center justify-center p-1.5 rounded-lg text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
              title="Раскрыть чат"
              aria-label="Раскрыть чат"
            >
              <Maximize2 size={18} />
            </button>
          )}
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-6">
        {interviewQuestion && (
          <div className="rounded-2xl bg-indigo-50/70 border border-indigo-100 p-4 space-y-2">
            <p className="text-[10px] font-black uppercase tracking-[0.15em] text-indigo-600">
              AIR4 хочет узнать тебя лучше
            </p>
            <p className="text-[14px] leading-relaxed text-[#111827]">
              {interviewQuestion}
            </p>
          </div>
        )}
        {messages.map((msg, i) => renderBubble(msg, i))}
        {previewBubble && renderBubble(previewBubble, "preview")}
        {isLoading && (
          <div className="flex gap-1 px-1">
            <div className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
            <div className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
            <div className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce" />
          </div>
        )}
      </div>

      <div className="p-5 bg-chat border-t border-gray-100">
        {(attachment || attachmentError) && (
          <div className="mb-2 space-y-1.5">
            {attachment && (
              <div className="inline-flex items-center gap-2 max-w-full bg-indigo-50 border border-indigo-100 rounded-full pl-1 pr-2 py-1">
                {isImageAttachment(attachment) ? (
                  <img
                    src={`data:${attachment.media_type};base64,${attachment.data}`}
                    alt=""
                    className="w-6 h-6 rounded-full object-cover"
                  />
                ) : (
                  <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-[9px] font-black uppercase flex items-center justify-center">
                    PDF
                  </span>
                )}
                <span className="text-[11px] font-semibold text-indigo-700 truncate max-w-[160px]">
                  {attachment.name ?? "файл"}
                </span>
                <span className="text-[10px] text-indigo-500 font-mono">
                  {formatAttachmentSize(attachment)}
                </span>
                <button
                  type="button"
                  onClick={handleClearAttachment}
                  className="ml-1 w-5 h-5 rounded-full hover:bg-indigo-100 text-indigo-600 flex items-center justify-center"
                  aria-label="Убрать вложение"
                  title="Убрать вложение"
                >
                  <X size={12} />
                </button>
              </div>
            )}
            {attachmentError && (
              <p className="text-[11px] text-red-500">{attachmentError}</p>
            )}
          </div>
        )}
        <div className="relative group">
          <input
            ref={fileInputRef}
            type="file"
            accept={ATTACHMENT_ACCEPT}
            onChange={handleFileChange}
            className="hidden"
          />
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSend();
            }}
            placeholder="Поговорите с AIR4..."
            className="w-full bg-white border border-gray-100 rounded-[24px] py-3 pl-12 pr-12 text-sm focus:outline-none focus:border-accent focus:ring-4 focus:ring-accent/5 transition-all shadow-sm"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
            className="absolute left-3 top-2 text-gray-400 hover:text-accent disabled:opacity-30 transition-colors h-8 w-8 flex items-center justify-center rounded-full hover:bg-gray-50"
            aria-label="Прикрепить файл"
            title="Прикрепить изображение или PDF"
          >
            <Paperclip size={16} />
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={(!input.trim() && !attachment) || isLoading}
            className="absolute right-4 top-2 text-gray-400 hover:text-accent disabled:opacity-30 transition-colors h-8 w-8 flex items-center justify-center rounded-full hover:bg-gray-50"
          >
            <Send size={16} />
          </button>
        </div>
        <p className="text-[10px] text-center text-[#9ca3af] mt-4 uppercase tracking-[0.1em] font-bold">
          Говори правду. Помогай решать.
        </p>
      </div>
    </aside>
  );
}
