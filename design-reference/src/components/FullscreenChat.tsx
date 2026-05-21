import { useState, useRef, useEffect, useMemo } from "react";
import { Send, ArrowLeft, MessageSquare } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "../lib/utils";
import ReactMarkdown from "react-markdown";
import { loadChatHistory, saveChatHistory } from "../lib/chatStorage";
import type { Message, Page } from "../types";
import type {
  Summary,
  Project,
  BodyMetric,
  Workout,
  Dilemma,
  UserFact,
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
}

type ContextPill = {
  label: string;
  tone: "blue" | "gray" | "red" | "yellow";
};

const PILL_STYLES: Record<ContextPill["tone"], string> = {
  blue: "bg-blue-50 text-blue-700 border border-blue-100",
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
  if (diffSec < 60) return "just now";
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) {
    return remMins > 0 ? `${hours}h ${remMins}m ago` : `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
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
}: FullscreenChatProps) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>(() => loadChatHistory());
  const scrollRef = useRef<HTMLDivElement>(null);

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
      if (period) out.push({ label: `FINANCE: ${period}`, tone: "blue" });
    }
    const activeProjects = projects.filter((p) => p.status === "active");
    if (activeProjects.length > 0) {
      out.push({
        label: `${activeProjects.length} ACTIVE PROJECT${activeProjects.length === 1 ? "" : "S"}`,
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
      out.push({ label: `HEALTH: ${gap}D GAP`, tone: "red" });
    }
    const openDilemma = dilemmas.find((d) => d.status === "open");
    if (openDilemma?.title) {
      out.push({
        label: `OPEN DILEMMA: ${firstWords(openDilemma.title, 2).toUpperCase()}`,
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

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim()) return;
    const text = input.trim();
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, chatHistory: messages }),
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.content ?? data.response ?? "" },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "AIR4 offline. Connection failed." },
      ]);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#f4f5f7] overflow-hidden">
      <header className="px-8 py-6 bg-white border-b border-gray-100 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
            <MessageSquare size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-black text-gray-900 tracking-tight leading-none uppercase">
              AIR4
            </h1>
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mt-1">
              Master Agent
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 border-[1.5px] border-[#6366f1] text-[#6366f1] px-5 py-2.5 rounded-[10px] font-bold text-[13px] uppercase tracking-wider hover:bg-indigo-50 transition-all shadow-sm bg-white"
        >
          <ArrowLeft size={16} />
          Back to {previousPage}
        </button>
      </header>

      <div className="flex-1 flex min-h-0">
        <div className="w-[30%] border-r border-gray-100 bg-white/50 p-8 overflow-y-auto space-y-6">
          <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
            <h2 className="text-[11px] font-bold text-[#9ca3af] uppercase tracking-[0.1em] mb-4">
              This Session
            </h2>
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                  Current page
                </span>
                <span className="text-[13px] font-semibold text-gray-800">
                  {previousPage}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                  Started
                </span>
                <span className="text-[13px] font-mono font-semibold text-gray-900">
                  {sessionAge}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
            <h2 className="text-[11px] font-bold text-[#9ca3af] uppercase tracking-[0.1em] mb-4">
              Loaded Context
            </h2>
            {pills.length === 0 ? (
              <p className="text-[13px] text-gray-500 leading-relaxed">
                No context loaded yet — data appears as it syncs.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {pills.map((pill, i) => (
                  <span
                    key={`${pill.label}-${i}`}
                    className={cn(
                      "px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider",
                      PILL_STYLES[pill.tone]
                    )}
                  >
                    {pill.label}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
            <h2 className="text-[11px] font-bold text-[#9ca3af] uppercase tracking-[0.1em] mb-4">
              Memory
            </h2>
            {topFacts.length === 0 ? (
              <p className="text-[13px] text-gray-500 leading-relaxed">
                AIR4 hasn't locked in any high-confidence facts yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {topFacts.map((f) => (
                  <li
                    key={f.key}
                    className="text-[13px] font-medium text-gray-700 leading-snug"
                  >
                    <span className="text-[10px] font-black text-indigo-600 uppercase tracking-wider mr-2">
                      {f.key.replace(/_/g, " ")}
                    </span>
                    <span>{f.value}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
              AIR4 is using {facts.length} memor{facts.length === 1 ? "y" : "ies"} + current session
            </p>
          </div>
        </div>

        <div className="flex-1 flex flex-col min-w-0 bg-white">
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-12 py-10 space-y-10">
            {messages.length === 0 ? (
              <p className="text-[14px] text-[#9ca3af] text-center mt-20">
                No messages yet. Start a conversation with AIR4.
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
                  {msg.role === "assistant" && (
                    <span className="text-[10px] font-black text-indigo-600 uppercase tracking-[0.2em]">
                      AIR4
                    </span>
                  )}
                  <div
                    className={cn(
                      "px-6 py-4 rounded-[12px] text-[15px] leading-relaxed shadow-sm",
                      msg.role === "user"
                        ? "bg-[#f3f4f6] text-[#374151]"
                        : "bg-white border-l-[4px] border-l-indigo-600 text-[#111827]"
                    )}
                  >
                    <div className="prose prose-slate max-w-none">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  </div>
                </motion.div>
              ))
            )}
          </div>

          <div className="px-12 py-8 bg-white border-t border-gray-100">
            <div className="relative group max-w-4xl mx-auto">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSend();
                }}
                placeholder="Talk to AIR4..."
                className="w-full bg-gray-50 border-2 border-transparent rounded-full py-4 px-8 pr-16 text-[16px] focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-8 focus:ring-indigo-600/5 transition-all shadow-inner"
              />
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={!input.trim()}
                className="absolute right-3 top-2 bottom-2 aspect-square rounded-full bg-indigo-600 text-white flex items-center justify-center hover:bg-indigo-700 disabled:opacity-40 transition-all shadow-md shadow-indigo-500/20"
              >
                <Send size={20} className="ml-0.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
