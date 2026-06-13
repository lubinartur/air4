import { useState, useRef, useEffect, useMemo, type ChangeEvent } from "react";
import { ArrowRight, Maximize2, Paperclip, RefreshCw, X } from "lucide-react";
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
      <div
        className="max-w-[90%] px-4 py-2.5 rounded-[12px] text-[14px] leading-relaxed text-[#f1f5f9] transition-all"
        style={
          msg.role === "user"
            ? { background: "#2a1a0a" }
            : { background: "#1e1e2e", borderLeft: "2px solid #f97316" }
        }
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
          <div className="prose prose-sm prose-invert break-words">
            <ReactMarkdown>{msg.content}</ReactMarkdown>
          </div>
        ) : null}
      </div>
    </div>
  );

  return (
    <aside
      className="w-[340px] flex flex-col shrink-0 my-2 mr-2 rounded-[20px] overflow-hidden h-[calc(100vh-16px)]"
      style={{
        background: "#13131f",
      }}
    >
      <header
        className="px-5 py-4 border-b flex items-center justify-between gap-3 bg-transparent"
        style={{ borderColor: "rgba(255,255,255,0.06)" }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-[13px] shrink-0"
            style={{ backgroundColor: "#f97316" }}
          >
            A4
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[14px] font-semibold text-[#f1f5f9]">
                AIR4
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
            </div>
            <span className="text-[11px] text-[#64748b]">AI Advisor · Online</span>
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-1">
          {onRefreshObservations && (
            <button
              type="button"
              onClick={onRefreshObservations}
              disabled={observationsRefreshing}
              className="flex items-center justify-center p-1.5 rounded-lg text-[#6b7280] hover:text-[#f97316] hover:bg-white/5 disabled:opacity-40 transition-colors"
              title="Сгенерировать наблюдения"
              aria-label="Сгенерировать наблюдения"
            >
              <RefreshCw
                size={16}
                className={cn(observationsRefreshing && "animate-spin")}
              />
            </button>
          )}
          {onExpand && (
            <button
              type="button"
              onClick={onExpand}
              className="flex items-center justify-center p-1.5 rounded-lg text-[#6b7280] hover:text-[#f97316] hover:bg-white/5 transition-colors"
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
          <div
            className="rounded-2xl p-4 space-y-2 border"
            style={{
              background: "linear-gradient(135deg, #1a0a00 0%, #0f0f14 100%)",
              borderColor: "rgba(249,115,22,0.3)",
            }}
          >
            <p className="text-[10px] font-black uppercase tracking-[0.15em] text-[#f97316]">
              AIR4 хочет узнать тебя лучше
            </p>
            <p className="text-[14px] leading-relaxed text-[#f1f5f9]">
              {interviewQuestion}
            </p>
          </div>
        )}
        {messages.map((msg, i) => renderBubble(msg, i))}
        {previewBubble && renderBubble(previewBubble, "preview")}
        {isLoading && (
          <div className="flex gap-1 px-1">
            <div className="w-1 h-1 bg-[#f97316] rounded-full animate-bounce [animation-delay:-0.3s]" />
            <div className="w-1 h-1 bg-[#f97316] rounded-full animate-bounce [animation-delay:-0.15s]" />
            <div className="w-1 h-1 bg-[#f97316] rounded-full animate-bounce" />
          </div>
        )}
      </div>

      <div
        className="p-4 border-t"
        style={{
          borderColor: "rgba(249,115,22,0.12)",
          backgroundColor: "#0f0f14",
        }}
      >
        {(attachment || attachmentError) && (
          <div className="mb-2 space-y-1.5">
            {attachment && (
              <div className="inline-flex items-center gap-2 max-w-full bg-[#1a1a24] border border-[#2a2a3a] rounded-full pl-1 pr-2 py-1">
                {isImageAttachment(attachment) ? (
                  <img
                    src={`data:${attachment.media_type};base64,${attachment.data}`}
                    alt=""
                    className="w-6 h-6 rounded-full object-cover"
                  />
                ) : (
                  <span className="w-6 h-6 rounded-full bg-[#f97316] text-white text-[9px] font-black uppercase flex items-center justify-center">
                    PDF
                  </span>
                )}
                <span className="text-[11px] font-semibold text-[#e2e8f0] truncate max-w-[160px]">
                  {attachment.name ?? "файл"}
                </span>
                <span className="text-[10px] text-[#94a3b8] font-mono">
                  {formatAttachmentSize(attachment)}
                </span>
                <button
                  type="button"
                  onClick={handleClearAttachment}
                  className="ml-1 w-5 h-5 rounded-full hover:bg-white/10 text-[#94a3b8] flex items-center justify-center"
                  aria-label="Убрать вложение"
                  title="Убрать вложение"
                >
                  <X size={12} />
                </button>
              </div>
            )}
            {attachmentError && (
              <p className="text-[11px] text-red-400">{attachmentError}</p>
            )}
          </div>
        )}
        <div className="flex items-center gap-2 rounded-full bg-[#1a1a24] border border-[#2a2a3a] pl-2 pr-1.5 py-1.5 focus-within:border-[#f97316]/50 transition-colors">
          <input
            ref={fileInputRef}
            type="file"
            accept={ATTACHMENT_ACCEPT}
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
            className="shrink-0 text-[#6b7280] hover:text-[#f97316] disabled:opacity-30 transition-colors h-8 w-8 flex items-center justify-center rounded-full"
            aria-label="Прикрепить файл"
            title="Прикрепить изображение или PDF"
          >
            <Paperclip size={16} />
          </button>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSend();
            }}
            placeholder="Поговорите с AIR4..."
            className="flex-1 min-w-0 bg-transparent border-0 text-sm text-white placeholder:text-[#4b5563] focus:outline-none"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={(!input.trim() && !attachment) || isLoading}
            className="shrink-0 h-8 w-8 flex items-center justify-center rounded-full bg-[#f97316] text-white disabled:opacity-30 hover:bg-[#ea6a06] transition-colors"
            aria-label="Отправить"
          >
            <ArrowRight size={16} />
          </button>
        </div>
        <p className="text-[10px] text-center text-[#64748b] mt-3 uppercase tracking-[0.1em] font-bold">
          Говори правду. Помогай решать.
        </p>
      </div>
    </aside>
  );
}
