import { useState, useRef, useEffect, useMemo, type ChangeEvent } from "react";
import { Send, ArrowLeft, Paperclip, X } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "../lib/utils";
import ReactMarkdown from "react-markdown";
import { loadChatHistory, saveChatHistory } from "../lib/chatStorage";
import type { Message, MessageAttachment, Page } from "../types";
import { fetchChatHistory, streamChat } from "../lib/api";
import {
  ATTACHMENT_ACCEPT,
  describeAttachmentError,
  formatAttachmentSize,
  isImageAttachment,
  readFileAsAttachment,
} from "../lib/chatAttachments";
import { MessageAttachmentView } from "./MessageAttachmentView";
import { EnergyStateDropdown } from "./EnergyStateDropdown";
import { PAGE_LABELS } from "../constants";
import type {
  Summary,
  Project,
  BodyMetric,
  Workout,
  Dilemma,
  UserFact,
  ChatResponseMeta,
} from "../lib/api";

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
}: FullscreenChatProps) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>(() => loadChatHistory());
  const [attachment, setAttachment] = useState<MessageAttachment | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
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
    const text = input.trim();
    const outgoingAttachment = attachment;
    const historyBeforeAssistant = messages;
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: text,
        attachment: outgoingAttachment ?? undefined,
      },
      { role: "assistant", content: "", chunks: [], isStreaming: true },
    ]);
    setInput("");
    setAttachment(null);
    setAttachmentError(null);

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
          // Backend appends `message` as the current user turn, so the
          // history we send must NOT already include it.
          history: historyBeforeAssistant,
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

      onMessageSent?.({ recurring_updated: meta?.recurring_updated });
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

  return (
    <div className="flex flex-col h-full bg-[#f4f5f7] overflow-hidden">
      <header className="px-4 md:px-8 py-4 md:py-6 bg-white border-b border-gray-100 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-black flex items-center justify-center overflow-hidden shadow-lg shadow-black/20">
            <img src="/ar4-test.svg" className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-gray-900 tracking-tight leading-none uppercase">
              AIR4
            </h1>
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mt-1">
              Главный агент
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <EnergyStateDropdown />
          <button
            type="button"
            onClick={onBack}
            className="hidden md:flex items-center gap-2 border-[1.5px] border-[#f97316] text-[#f97316] px-5 py-2.5 rounded-[10px] font-bold text-[13px] uppercase tracking-wider hover:bg-[#f97316]/10 transition-all shadow-sm bg-white"
          >
            <ArrowLeft size={16} />
            Назад: {PAGE_LABELS[previousPage] ?? previousPage}
          </button>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 flex flex-col min-w-0 bg-white">
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 md:px-12 py-6 md:py-10 space-y-6 md:space-y-10">
            {messages.length === 0 ? (
              <p className="text-[14px] text-[#9ca3af] text-center mt-20">
                Сообщений пока нет. Начните диалог с AIR4.
              </p>
            ) : (
              messages.map((msg, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "flex flex-col gap-2 max-w-[80%]",
                    msg.role === "user" ? "ml-auto items-end" : "mr-auto items-start"
                  )}
                >
                  {msg.role === "assistant" &&
                    morningBriefText !== null &&
                    msg.content === morningBriefText && (
                      <span className="text-[11px] font-medium text-gray-400">
                        Доброе утро
                      </span>
                    )}
                  {msg.role === "assistant" && (
                    <span className="text-[10px] font-black text-[#f97316] uppercase tracking-[0.2em]">
                      AIR4
                    </span>
                  )}
                  <div
                    className={cn(
                      "px-6 py-4 rounded-[12px] text-[15px] leading-relaxed shadow-sm",
                      msg.role === "user"
                        ? "bg-[#f3f4f6] text-[#374151]"
                        : "bg-white border-l-[4px] border-l-[#f97316] text-[#111827]"
                    )}
                  >
                    {msg.attachment && (
                      <MessageAttachmentView
                        attachment={msg.attachment}
                        size="wide"
                        className={msg.content ? "mb-3" : undefined}
                      />
                    )}
                    {msg.role === "assistant" && msg.isStreaming && msg.chunks ? (
                      // Streaming render — each SSE delta is its own
                      // <span> so the CSS keyframe runs once per chunk.
                      <div className="break-words whitespace-pre-wrap">
                        {msg.chunks.map((chunk, idx) => (
                          <span key={idx} className="air4-fade-chunk">
                            {chunk}
                          </span>
                        ))}
                      </div>
                    ) : msg.content ? (
                      <div className="prose prose-slate max-w-none">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    ) : null}
                  </div>
                </motion.div>
              ))
            )}
          </div>

          <div className="px-4 md:px-12 py-4 md:py-8 bg-white border-t border-gray-100">
            <div className="max-w-4xl mx-auto">
              {(attachment || attachmentError) && (
                <div className="mb-3 space-y-1.5">
                  {attachment && (
                    <div className="inline-flex items-center gap-2.5 max-w-full bg-[#f97316]/15 border border-[#f97316]/30 rounded-full pl-1.5 pr-3 py-1.5">
                      {isImageAttachment(attachment) ? (
                        <img
                          src={`data:${attachment.media_type};base64,${attachment.data}`}
                          alt=""
                          className="w-7 h-7 rounded-full object-cover"
                        />
                      ) : (
                        <span className="w-7 h-7 rounded-full bg-[#f97316] text-white text-[10px] font-black uppercase flex items-center justify-center">
                          PDF
                        </span>
                      )}
                      <span className="text-[13px] font-semibold text-[#f97316] truncate max-w-[280px]">
                        {attachment.name ?? "файл"}
                      </span>
                      <span className="text-[11px] text-[#f97316] font-mono">
                        {formatAttachmentSize(attachment)}
                      </span>
                      <button
                        type="button"
                        onClick={handleClearAttachment}
                        className="ml-1 w-6 h-6 rounded-full hover:bg-[#f97316]/10 text-[#f97316] flex items-center justify-center"
                        aria-label="Убрать вложение"
                        title="Убрать вложение"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}
                  {attachmentError && (
                    <p className="text-[12px] text-red-500">{attachmentError}</p>
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
                    if (e.key === "Enter") void handleSend();
                  }}
                  placeholder="Поговорите с AIR4..."
                  className="w-full bg-gray-50 border-2 border-transparent rounded-full py-4 pl-16 pr-16 text-[16px] focus:outline-none focus:bg-white focus:border-[#f97316] focus:ring-8 focus:ring-[#f97316]/5 transition-all shadow-inner"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute left-3 top-2 bottom-2 aspect-square rounded-full bg-gray-100 text-gray-600 flex items-center justify-center hover:bg-gray-200 transition-colors"
                  aria-label="Прикрепить файл"
                  title="Прикрепить изображение или PDF"
                >
                  <Paperclip size={18} />
                </button>
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={!input.trim() && !attachment}
                  className="absolute right-3 top-2 bottom-2 aspect-square rounded-full bg-[#f97316] text-white flex items-center justify-center hover:bg-[#ea6a06] disabled:opacity-40 transition-all shadow-md shadow-[#f97316]/20"
                >
                  <Send size={20} className="ml-0.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
