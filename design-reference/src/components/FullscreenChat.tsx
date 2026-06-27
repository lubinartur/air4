import { useState, useRef, useEffect, useMemo, type ChangeEvent } from "react";
import { ArrowLeft, ArrowUp, Paperclip, X } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "../lib/utils";
import ReactMarkdown, { type Components } from "react-markdown";
import { loadChatHistory, saveChatHistory } from "../lib/chatStorage";
import type { Message, MessageAttachment, Page } from "../types";
import {
  fetchChatHistory,
  streamChat,
  confirmChatAction,
  cancelChatAction,
  type BodyMetric,
  type ChatAgent,
  type ChatLaunchRequest,
  type ChatResponseMeta,
  type Dilemma,
  type PendingChatAction,
  type Project,
  type Summary,
  type UserFact,
  type Workout,
} from "../lib/api";
import {
  ATTACHMENT_ACCEPT,
  describeAttachmentError,
  formatAttachmentSize,
  isImageAttachment,
  readFileAsAttachment,
} from "../lib/chatAttachments";
import { MessageAttachmentView } from "./MessageAttachmentView";
import { EnergyStateDropdown } from "./EnergyStateDropdown";
import { PendingActionBar } from "./PendingActionBar";
import { PAGE_LABELS } from "../constants";

interface FullscreenChatProps {
  onBack: () => void;
  previousPage?: Page;
  summary?: Summary | null;
  projects?: Project[];
  bodyMetrics?: BodyMetric[];
  workouts?: Workout[];
  dilemmas?: Dilemma[];
  facts?: UserFact[];
  onMessageSent?: (meta?: ChatResponseMeta) => void;
  pendingChatRequest?: ChatLaunchRequest | null;
  onPendingChatRequestConsumed?: () => void;
}

type ContextPill = {
  label: string;
  tone: "blue" | "gray" | "red" | "yellow";
};

const PILL_STYLES: Record<ContextPill["tone"], string> = {
  blue: "bg-[#f97316]/15 text-[#f97316] border border-[#f97316]/30",
  gray: "bg-gray-100 text-gray-700 border border-gray-200",
  red: "bg-red-50 text-red-700 border border-red-100",
  yellow: "bg-amber-50 text-amber-700 border border-amber-100",
};

function daysSince(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const t = Date.parse(dateStr);
  if (Number.isNaN(t)) return null;
  const diffMs = Date.now() - t;
  if (diffMs < 0) return 0;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function formatPeriod(start: string | null, end: string | null): string {
  if (start && end) return `${start}–${end}`;
  return start || end || "";
}

function formatSessionAge(startedAtMs: number, nowMs: number): string {
  const diffSec = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
  if (diffSec < 60) return "только что";
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins} мин назад`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) {
    return remMins > 0 ? `${hours} ч ${remMins} мин назад` : `${hours} ч назад`;
  }
  const days = Math.floor(hours / 24);
  return `${days} дн назад`;
}

function truncate(text: string, max: number): string {
  const clean = text.trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max).trimEnd() + "…";
}

function firstWords(text: string, n: number): string {
  return text.trim().split(/\s+/).slice(0, n).join(" ");
}

/** Premium fullscreen assistant markdown — Claude/ChatGPT style. */
const fullscreenMarkdownComponents: Components = {
  hr: () => null,
  p: ({ children }) => <p className="mb-4 last:mb-0">{children}</p>,
  strong: ({ children }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  em: ({ children }) => <em>{children}</em>,
  a: ({ children, href }) => (
    <a
      href={href}
      className="text-[#f97316] no-underline hover:opacity-90"
      target="_blank"
      rel="noreferrer"
    >
      {children}
    </a>
  ),
  h1: ({ children }) => (
    <p className="mb-4 font-semibold text-[#e5e5e5]">{children}</p>
  ),
  h2: ({ children }) => (
    <p className="mb-4 font-semibold text-[#e5e5e5]">{children}</p>
  ),
  h3: ({ children }) => (
    <p className="mb-3 font-semibold text-[#e5e5e5]">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="mb-4 last:mb-0 list-disc pl-5 space-y-1.5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-4 last:mb-0 list-decimal pl-5 space-y-1.5">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-[1.7]">{children}</li>,
  pre: ({ children }) => (
    <pre className="mb-4 last:mb-0 rounded-lg bg-[#0f0f14] p-3 overflow-x-auto font-mono text-[13px] leading-relaxed">
      {children}
    </pre>
  ),
  code: ({ className, children, ...props }) => {
    const isBlock = /language-/.test(className ?? "");
    if (isBlock) {
      return (
        <code className={cn(className, "font-mono text-[13px]")} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code
        className="bg-white/[0.08] px-1.5 py-0.5 rounded font-mono text-[0.9em]"
        {...props}
      >
        {children}
      </code>
    );
  },
};

function messageTopSpacing(index: number, messages: Message[]): string {
  if (index === 0) return "";
  const prev = messages[index - 1];
  const curr = messages[index];
  if (curr.role === "user" && prev.role === "assistant") return "mt-8";
  return "mt-6";
}

export function FullscreenChat({
  onBack,
  previousPage = "Overview",
  summary = null,
  projects = [],
  bodyMetrics = [],
  workouts = [],
  dilemmas = [],
  facts = [],
  onMessageSent,
  pendingChatRequest,
  onPendingChatRequestConsumed,
}: FullscreenChatProps) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>(() => loadChatHistory());
  const [sessionAgent, setSessionAgent] = useState<ChatAgent | undefined>();
  const [attachment, setAttachment] = useState<MessageAttachment | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [pendingActions, setPendingActions] = useState<PendingChatAction[]>([]);
  const [pendingBusy, setPendingBusy] = useState(false);
  const sendMessageRef = useRef<
    (text: string, options?: { agent?: ChatAgent }) => Promise<void>
  >(() => Promise.resolve());
  // Text of the Morning Brief message (if shown), so we can render a
  // "Доброе утро" label above that specific assistant bubble.
  const [morningBriefText, setMorningBriefText] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [sessionStartedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const pills = useMemo<ContextPill[]>(() => {
    const out: ContextPill[] = [];
    if (summary && (summary.period_start || summary.period_end)) {
      const period = formatPeriod(summary.period_start, summary.period_end);
      if (period) out.push({ label: `ФИНАНСЫ: ${period}`, tone: "blue" });
    }
    const activeProjects = projects.filter((p) => p.status === "active");
    if (activeProjects.length > 0) {
      out.push({
        label: `АКТИВНЫХ ПРОЕКТОВ: ${activeProjects.length}`,
        tone: "gray",
      });
    }
    const lastWorkoutDate = workouts
      .map((w) => w.date)
      .filter(Boolean)
      .sort()
      .pop();
    const gap = daysSince(lastWorkoutDate);
    if (gap !== null && gap > 3) {
      out.push({ label: `ЗДОРОВЬЕ: ПЕРЕРЫВ ${gap} ДН`, tone: "red" });
    }
    const openDilemma = dilemmas.find((d) => d.status === "open");
    if (openDilemma?.title) {
      out.push({
        label: `ОТКРЫТАЯ ДИЛЕММА: ${firstWords(openDilemma.title, 2).toUpperCase()}`,
        tone: "yellow",
      });
    }
    return out;
  }, [summary, projects, workouts, dilemmas]);

  const topFacts = useMemo(() => {
    return facts
      .filter((f) => (f.confidence ?? 0) > 0.8)
      .slice(0, 3)
      .map((f) => ({
        key: f.key,
        value: truncate(f.value ?? "", 60),
      }));
  }, [facts]);

  const sessionAge = formatSessionAge(sessionStartedAt, now);

  useEffect(() => {
    saveChatHistory(messages);
  }, [messages]);

  // Load chat history FIRST, then request the Morning Brief and append it
  // as the LAST message (below the history) so it isn't overwritten by the
  // history fetch. The brief only shows when the user hasn't written today.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchChatHistory(50);
        if (!cancelled) {
          const remote: Message[] = res.messages
            .filter(
              (m) =>
                (m.role === "user" || m.role === "assistant") &&
                m.content.trim() !== ""
            )
            .map((m) => ({
              role: m.role,
              content: m.content,
              attachment: m.attachment ?? undefined,
            }));
          if (remote.length > 0) setMessages(remote);
        }
      } catch {
        /* keep localStorage fallback */
      }

      try {
        const r = await fetch("/api/chat/morning-brief");
        const data: { should_show?: boolean; message?: string } | null = r.ok
          ? await r.json()
          : null;
        if (cancelled || !data || !data.should_show || !data.message) return;
        const briefText = data.message;
        setMorningBriefText(briefText);
        setMessages((prev) => {
          if (
            prev.some(
              (m) => m.role === "assistant" && m.content === briefText,
            )
          ) {
            return prev;
          }
          return [...prev, { role: "assistant", content: briefText }];
        });
      } catch {
        /* brief is optional — stay silent on error */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

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

  const sendMessage = async (
    text: string,
    options?: { agent?: ChatAgent },
  ) => {
    const outgoingAttachment = attachment;
    if (!text.trim() && !outgoingAttachment) return;

    const activeAgent = options?.agent ?? sessionAgent;
    if (options?.agent) setSessionAgent(options.agent);

    const historyBeforeAssistant = messages;
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: text.trim(),
        attachment: outgoingAttachment ?? undefined,
      },
      { role: "assistant", content: "", chunks: [], isStreaming: true },
    ]);
    setInput("");
    setAttachment(null);
    setAttachmentError(null);
    setPendingActions([]);

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
    } catch {
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
    }
  };

  sendMessageRef.current = sendMessage;

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
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

  return (
    <div className="flex flex-col h-full bg-[#0f0f14] overflow-hidden">
      <header className="px-5 py-4 bg-[#13131f] border-b border-white/[0.06] flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 flex items-center justify-center shrink-0 overflow-hidden">
            <img src="/ar4-test.svg" alt="AIR4" className="w-full h-full object-contain" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h1 className="text-[14px] font-bold text-white leading-none">
                AIR4
              </h1>
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
            </div>
            <p className="text-[11px] text-[#666666] mt-0.5">AI Advisor · Online</p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onBack}
            className="hidden md:flex items-center gap-2 border border-white/[0.08] text-[#94a3b8] px-4 py-2 rounded-full text-[12px] font-medium bg-white/[0.04] hover:bg-white/[0.08] transition-colors"
          >
            <ArrowLeft size={14} />
            {PAGE_LABELS[previousPage] ?? previousPage}
          </button>
          <EnergyStateDropdown />
        </div>
      </header>

      <div className="flex-1 flex flex-col min-h-0 bg-[#13131f]">
        <div
          ref={scrollRef}
          className="air4-chat-scroll flex-1 min-h-0 w-full overflow-y-auto"
        >
          <div className="w-full max-w-[720px] mx-auto px-6 py-8 flex flex-col">
            {messages.length === 0 ? (
              <p className="text-[14px] text-[#666666] text-center mt-16">
                Сообщений пока нет. Начните диалог с AIR4.
              </p>
            ) : (
              messages.map((msg, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn("w-full", messageTopSpacing(i, messages))}
                >
                  {msg.role === "user" ? (
                    <div className="ml-auto max-w-[60%] rounded-[18px] rounded-br-[4px] border border-white/[0.08] bg-[#1e1e2e] px-4 py-3 text-[14px] leading-[1.5] text-[#f0f0f0] break-words">
                      {msg.attachment && (
                        <MessageAttachmentView
                          attachment={msg.attachment}
                          size="wide"
                          className={msg.content ? "mb-2" : undefined}
                        />
                      )}
                      {msg.content ? (
                        <span className="whitespace-pre-wrap">{msg.content}</span>
                      ) : null}
                    </div>
                  ) : (
                    <div className="w-full text-[15px] leading-[1.7] text-[#e5e5e5] break-words">
                      {morningBriefText !== null &&
                        msg.content === morningBriefText && (
                          <span className="block text-[11px] font-medium uppercase tracking-wide text-[#666666] mb-2">
                            Доброе утро
                          </span>
                        )}
                      {msg.attachment && (
                        <MessageAttachmentView
                          attachment={msg.attachment}
                          size="wide"
                          className={msg.content ? "mb-3" : undefined}
                        />
                      )}
                      {msg.isStreaming && !msg.content ? (
                        <div className="air4-typing" aria-label="AIR4 печатает">
                          <span />
                          <span />
                          <span />
                        </div>
                      ) : msg.content ? (
                        <div
                          className={cn(
                            "air4-chat-fullscreen-md break-words [&_*]:no-underline",
                            msg.isStreaming && "air4-streaming",
                          )}
                        >
                          <ReactMarkdown components={fullscreenMarkdownComponents}>
                            {msg.content}
                          </ReactMarkdown>
                          {msg.isStreaming && (
                            <span className="air4-caret" aria-hidden="true" />
                          )}
                        </div>
                      ) : null}
                    </div>
                  )}
                </motion.div>
              ))
            )}
          </div>
        </div>

        <div className="px-6 py-3 border-t border-white/[0.06] shrink-0 bg-[#13131f]">
          <div className="max-w-[720px] mx-auto w-full">
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
                  <div className="inline-flex items-center gap-2 max-w-full bg-[#1a1a24] border border-white/[0.08] rounded-full pl-1 pr-2 py-1">
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
                    <span className="text-[11px] font-semibold text-[#e2e8f0] truncate max-w-[200px]">
                      {attachment.name ?? "файл"}
                    </span>
                    <span className="text-[10px] text-[#666666] font-mono">
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
                className="shrink-0 text-[#666666] hover:text-[#f97316] transition-colors h-9 w-9 flex items-center justify-center rounded-full"
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
                  if (e.key === "Enter") void handleSend();
                }}
                placeholder="Поговорите с AIR4..."
                className="flex-1 min-w-0 rounded-full border border-white/[0.08] bg-white/[0.06] px-4 py-2.5 text-[14px] md:text-[15px] text-white placeholder:text-[#666666] focus:outline-none focus:border-[#f97316]/40"
              />
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={!input.trim() && !attachment}
                className="shrink-0 h-9 w-9 flex items-center justify-center rounded-full bg-[#f97316] text-white disabled:opacity-30 hover:brightness-110 transition-all"
                aria-label="Отправить"
              >
                <ArrowUp size={18} strokeWidth={2.5} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
