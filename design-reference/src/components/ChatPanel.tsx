import { useState, useRef, useEffect, useMemo, type ChangeEvent } from "react";
import { ArrowUp, Maximize2, Paperclip, RefreshCw, X } from "lucide-react";
import { Message, MessageAttachment, Page } from "../types";
import { cn } from "../lib/utils";
import ReactMarkdown, { type Components } from "react-markdown";
import {
  fetchChatHistory,
  fetchInterviewQuestion,
  streamChat,
  submitInterviewAnswer,
  confirmChatAction,
  cancelChatAction,
  type ChatAgent,
  type ChatLaunchRequest,
  type ChatResponseMeta,
  type Observation,
  type PendingChatAction,
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
import { PendingActionBar } from "./PendingActionBar";

/** Soft assistant markdown — no rules, no underlines, medium-weight bold. */
const assistantMarkdownComponents: Components = {
  hr: () => null,
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  strong: ({ children }) => (
    <strong className="font-medium text-[#e5e5e5]">{children}</strong>
  ),
  em: ({ children }) => <span>{children}</span>,
  u: ({ children }) => <span>{children}</span>,
  a: ({ children, href }) => (
    <a
      href={href}
      className="text-[#f97316] no-underline decoration-0 hover:opacity-90"
      target="_blank"
      rel="noreferrer"
    >
      {children}
    </a>
  ),
  h1: ({ children }) => (
    <p className="mb-2 font-medium text-[#e5e5e5]">{children}</p>
  ),
  h2: ({ children }) => (
    <p className="mb-2 font-medium text-[#e5e5e5]">{children}</p>
  ),
  h3: ({ children }) => (
    <p className="mb-2 font-medium text-[#e5e5e5]">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="mb-2 last:mb-0 list-disc pl-4 space-y-1">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2 last:mb-0 list-decimal pl-4 space-y-1">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-[1.5]">{children}</li>,
};

interface ChatPanelProps {
  currentPage: Page;
  observation?: Observation | null;
  observationsRefreshing?: boolean;
  onRefreshObservations?: () => void;
  onMessageSent?: (meta?: ChatResponseMeta) => void;
  pendingChatRequest?: ChatLaunchRequest | null;
  onPendingChatRequestConsumed?: () => void;
  onExpand?: () => void;
}

export function ChatPanel({
  currentPage,
  observation = null,
  observationsRefreshing = false,
  onRefreshObservations,
  onMessageSent,
  pendingChatRequest,
  onPendingChatRequestConsumed,
  onExpand,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>(() => loadChatHistory());
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sessionAgent, setSessionAgent] = useState<ChatAgent | undefined>();
  const [interviewQuestion, setInterviewQuestion] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<MessageAttachment | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [pendingActions, setPendingActions] = useState<PendingChatAction[]>([]);
  const [pendingBusy, setPendingBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sendMessageRef = useRef<
    (text: string, options?: { agent?: ChatAgent }) => Promise<void>
  >(() => Promise.resolve());

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
    if (!pendingChatRequest) return;
    const { message, agent, autoSend } = pendingChatRequest;
    onPendingChatRequestConsumed?.();
    if (agent) setSessionAgent(agent);
    if (autoSend) {
      void sendMessageRef.current(message, { agent });
      return;
    }
    setInput(message);
  }, [pendingChatRequest, onPendingChatRequestConsumed]);

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
    if (isLoading) return;
    if (!input.trim() && !attachment) return;
    await sendMessage(input.trim());
  };

  const currentPending = pendingActions[0];

  const handleConfirmPending = async (action: PendingChatAction) => {
    console.log("handleConfirmPending, pendingActions[0]:", pendingActions[0]);
    if (!action?.type || pendingBusy) return;
    setPendingActions((prev) => prev.slice(1));
    setPendingBusy(true);
    try {
      const res = await confirmChatAction(action);
      const note = res.message.replace(/^_|_$/g, "").trim();
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: note || "Изменение применено." },
      ]);
      onMessageSent?.({ recurring_updated: res.recurring_updated });
      // handleMessageSent → refetchFinanceRecurring when recurring_updated
    } catch {
      setPendingActions((prev) => [action, ...prev]);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Не удалось применить изменение.",
        },
      ]);
    } finally {
      setPendingBusy(false);
    }
  };

  const handleCancelPending = async (action: PendingChatAction) => {
    if (!action?.type || pendingBusy) return;
    setPendingActions((prev) => prev.slice(1));
    setPendingBusy(true);
    try {
      const res = await cancelChatAction(action);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: res.message },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Ок, не меняю данные." },
      ]);
    } finally {
      setPendingBusy(false);
    }
  };

  const sendMessage = async (
    text: string,
    options?: { agent?: ChatAgent },
  ) => {
    if (isLoading) return;
    const outgoingAttachment = attachment;
    if (!text.trim() && !outgoingAttachment) return;

    const activeAgent = options?.agent ?? sessionAgent;
    if (options?.agent) setSessionAgent(options.agent);

    const pendingInterview = interviewQuestion;
    const userMessage: Message = {
      role: "user",
      content: text.trim(),
      attachment: outgoingAttachment ?? undefined,
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setAttachment(null);
    setAttachmentError(null);
    setPendingActions([]);
    setIsLoading(true);

    if (pendingInterview) {
      setInterviewQuestion(null);
      try {
        await Promise.race([
          submitInterviewAnswer(pendingInterview, text.trim()),
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
          message: text.trim(),
          history: historyBeforeAssistant,
          current_page: currentPage,
          surface: activeAgent ? "dialogue" : undefined,
          agent: activeAgent,
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
            if (incoming.pending_actions?.length) {
              setPendingActions(incoming.pending_actions);
            }
          },
          onPendingAction: (action) => {
            console.log("pending_action SSE received:", action);
            setPendingActions((prev) =>
              prev.length > 0 ? prev : [action],
            );
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
        finalizeLast((last) => ({
          ...last,
          isStreaming: false,
          chunks: undefined,
        }));
      }
      onMessageSent?.(meta);
    } catch (error) {
      console.error("Chat send failed:", error);
      finalizeLast((last) => ({
        ...last,
        content: last.content || "Не удалось отправить сообщение.",
        isStreaming: false,
        chunks: undefined,
      }));
    } finally {
      setIsLoading(false);
    }
  };

  sendMessageRef.current = sendMessage;

  const renderBubble = (msg: Message, key: string | number) => (
    <div key={key} className="w-full max-w-full">
      <div
        className={cn(
          "text-[14px] leading-[1.5] break-words",
          msg.role === "user"
            ? "ml-auto max-w-[70%] px-3.5 py-2.5 rounded-[18px] rounded-br-[4px] bg-white/[0.08] text-[#e5e5e5]"
            : "mr-auto max-w-[85%] px-3.5 py-2.5 rounded-[18px] rounded-bl-[4px] bg-[#1e1e2e] text-[#e5e5e5]",
        )}
      >
        {msg.attachment && (
          <MessageAttachmentView
            attachment={msg.attachment}
            size="compact"
            className={msg.content ? "mb-2" : undefined}
          />
        )}
        {msg.role === "assistant" && msg.isStreaming && !msg.content ? (
          <div className="air4-typing" aria-label="AIR4 печатает">
            <span />
            <span />
            <span />
          </div>
        ) : msg.content ? (
          msg.role === "user" ? (
            <span className="whitespace-pre-wrap">{msg.content}</span>
          ) : (
            <div
              className={cn(
                "air4-chat-panel-md break-words [&_*]:no-underline",
                msg.isStreaming && "air4-streaming",
              )}
            >
              <ReactMarkdown components={assistantMarkdownComponents}>
                {msg.content}
              </ReactMarkdown>
              {msg.isStreaming && (
                <span className="air4-caret" aria-hidden="true" />
              )}
            </div>
          )
        ) : null}
      </div>
    </div>
  );

  return (
    <aside className="w-[340px] flex flex-col shrink-0 overflow-hidden rounded-2xl h-[calc(100vh-16px)] bg-[#13131f] border border-white/[0.08] mt-2 mb-2 mr-2 ml-0">
      <header className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 flex items-center justify-center shrink-0 overflow-hidden">
            <img
              src="/ar4-test.svg"
              alt="AIR4"
              className="w-full h-full object-contain"
            />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[14px] font-bold text-white">AIR4</span>
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
            </div>
            <span className="text-[11px] text-[#666666]">
              AI Advisor · Online
            </span>
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

      <div
        ref={scrollRef}
        className="air4-chat-scroll flex-1 min-h-0 max-w-full overflow-y-auto flex flex-col gap-3 p-4"
      >
        {interviewQuestion && (
          <div className="w-full max-w-full">
            <div className="mr-auto max-w-[85%] rounded-[18px] rounded-bl-[4px] p-3.5 space-y-1.5 border border-[#f97316]/30 bg-[#1e1e2e]">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#f97316]">
              AIR4 хочет узнать тебя лучше
            </p>
            <p className="text-[14px] leading-relaxed text-[#e5e5e5]">
              {interviewQuestion}
            </p>
            </div>
          </div>
        )}
        {messages.map((msg, i) => renderBubble(msg, i))}
        {previewBubble && renderBubble(previewBubble, "preview")}
      </div>

      <div className="px-4 py-3 border-t border-white/[0.06] shrink-0 bg-[#13131f]">
        {currentPending && (
          <PendingActionBar
            action={currentPending}
            busy={pendingBusy}
            onConfirm={(action) => void handleConfirmPending(action)}
            onCancel={(action) => void handleCancelPending(action)}
            className="mb-2"
          />
        )}
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
        <div className="flex items-center gap-2">
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
            className="shrink-0 text-[#666666] hover:text-[#f97316] disabled:opacity-30 transition-colors h-9 w-9 flex items-center justify-center rounded-full"
            aria-label="Прикрепить файл"
            title="Прикрепить изображение или PDF"
          >
            <Paperclip size={18} />
          </button>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSend();
            }}
            placeholder="Поговорите с AIR4..."
            className="flex-1 min-w-0 rounded-full border border-white/[0.08] bg-white/[0.06] px-4 py-2.5 text-[14px] text-white placeholder:text-[#666666] focus:outline-none focus:border-[#f97316]/40"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={(!input.trim() && !attachment) || isLoading}
            className="shrink-0 h-9 w-9 flex items-center justify-center rounded-full bg-[#f97316] text-white disabled:opacity-30 hover:brightness-110 transition-all"
            aria-label="Отправить"
          >
            <ArrowUp size={18} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </aside>
  );
}
