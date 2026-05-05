"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  chat,
  getProfile,
  getSummary,
  getTransactions,
  notifyFactsUpdated,
  type ChatMessage,
  type UserFact,
} from "@/lib/api";
import { chatPageContext, sidebarSubtitle } from "@/lib/pageContext";

type ChatLine =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      rememberedTitle?: string | null;
      learnedFacts?: UserFact[];
    };

const TEXTAREA_MAX_ROWS = 4;
const TEXTAREA_LINE_PX = 20;

function formatSpendingPeriodRu(
  start: string | null,
  end: string | null
): string | null {
  if (!start || !end) return null;
  const a = new Date(start.includes("T") ? start : `${start}T12:00:00`);
  const b = new Date(end.includes("T") ? end : `${end}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const sameYear = a.getFullYear() === b.getFullYear();
  const left = a.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
  });
  const right = b.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    ...(sameYear ? {} : { year: "numeric" as const }),
  });
  return `${left} — ${right}`;
}

/** Safe snippet for wrapping in single quotes inside the greeting. */
function sanitizeDescForGreeting(s: string): string {
  return s.trim().replace(/'/g, "′");
}

async function buildPageGreeting(pathname: string): Promise<string> {
  let name = "Арч";
  try {
    const profile = await getProfile();
    if (profile.name?.trim()) name = profile.name.trim();
  } catch {
    /* keep fallback */
  }

  if (pathname.startsWith("/dashboard")) {
    try {
      const summary = await getSummary();
      const period = formatSpendingPeriodRu(
        summary.period_start,
        summary.period_end
      );
      const total = summary.total_spent.toFixed(2);
      const base = period
        ? `Привет, ${name}! Вижу твои траты за ${period}. Общий расход €${total}. Что хочешь разобрать?`
        : `Привет, ${name}! Вижу твои траты на дашборде. Общий расход €${total}. Что хочешь разобрать?`;

      try {
        const page = await getTransactions({
          category: "other",
          is_debit: true,
          exclude_internal: true,
          limit: 50,
          skip: 0,
        });
        const topUnknown = page.items
          .filter((t) => t.amount > 50)
          .sort((a, b) => b.amount - a.amount)
          .slice(0, 2);
        if (topUnknown.length === 0) return base;
        const bullets = topUnknown.map(
          (t) =>
            `- '${sanitizeDescForGreeting(t.description)}' — €${t.amount.toFixed(2)}`
        );
        return `${base}\n\nКстати, заметил несколько непонятных трат:\n${bullets.join("\n")}\n\nЧто это такое?`;
      } catch {
        return base;
      }
    } catch {
      return `Привет, ${name}! Что хочешь разобрать?`;
    }
  }
  if (pathname.startsWith("/events")) {
    return `Привет, ${name}! Здесь твои жизненные события. Хочешь добавить что-то новое или найти связи с тратами?`;
  }
  if (pathname.startsWith("/facts")) {
    return `Привет, ${name}! Здесь всё что я знаю о тебе. Можешь удалить неверное или рассказать больше.`;
  }
  if (pathname.startsWith("/profile")) {
    return `Привет, ${name}! Здесь твой профиль — обнови данные, и я смогу точнее советовать по финансам.`;
  }
  if (pathname === "/" || pathname === "" || pathname.startsWith("/upload")) {
    return `Привет, ${name}! Загрузи выписку Swedbank и я сразу начну анализ.`;
  }
  return `Привет, ${name}! Чем могу помочь?`;
}

export function ChatSidebar() {
  const pathname = usePathname();
  const [messages, setMessages] = useState<ChatLine[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const greetingSeq = useRef(0);

  const subtitle = sidebarSubtitle(pathname);
  const pageCtx = chatPageContext(pathname);

  const history = useMemo((): ChatMessage[] => {
    return messages.slice(-20).map((m) => ({
      role: m.role,
      content: m.content,
    }));
  }, [messages]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, busy]);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const maxH = TEXTAREA_MAX_ROWS * TEXTAREA_LINE_PX + 16;
    el.style.height = `${Math.min(el.scrollHeight, maxH)}px`;
  }, [text]);

  useEffect(() => {
    const id = ++greetingSeq.current;
    let cancelled = false;

    void (async () => {
      const content = await buildPageGreeting(pathname);
      if (cancelled || id !== greetingSeq.current) return;
      setMessages((prev) => [...prev, { role: "assistant", content }]);
    })();

    return () => {
      cancelled = true;
    };
  }, [pathname]);

  async function onSend() {
    const msg = text.trim();
    if (!msg || busy) return;

    setText("");
    setBusy(true);
    const next: ChatLine[] = [...messages, { role: "user", content: msg }];
    setMessages(next);

    try {
      const res = await chat(msg, history, { currentPage: pageCtx });
      const learned =
        res.facts_saved && res.facts_saved.length > 0
          ? res.facts_saved
          : undefined;
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: res.response,
          rememberedTitle: res.event_saved?.title ?? null,
          learnedFacts: learned,
        },
      ]);
      if (learned?.length) notifyFactsUpdated();
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            e instanceof Error
              ? `Error: ${e.message}`
              : "Error: failed to contact backend",
          rememberedTitle: null,
          learnedFacts: undefined,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 max-h-full flex-col overflow-hidden bg-white">
      <header className="flex h-14 shrink-0 flex-col justify-center border-b border-zinc-100 px-4 leading-tight">
        <h2 className="text-sm font-semibold text-zinc-900">AIR4</h2>
        <p className="mt-0.5 truncate text-xs text-zinc-400">{subtitle}</p>
      </header>

      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden p-4"
      >
        {messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-2 py-8 text-center text-sm text-zinc-500">
            Ask AIR4 anything about your finances
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {messages.map((m, idx) =>
              m.role === "user" ? (
                <div
                  key={idx}
                  className="ml-auto max-w-[92%] rounded-2xl rounded-br-sm bg-zinc-900 px-4 py-2.5 text-sm leading-5 text-white"
                >
                  {m.content}
                </div>
              ) : (
                <div key={idx} className="mr-auto max-w-[95%]">
                  <div className="rounded-2xl rounded-bl-sm border border-zinc-100 bg-zinc-50 px-4 py-2.5 text-sm leading-5 text-zinc-900">
                    {m.content}
                  </div>
                  {m.rememberedTitle ? (
                    <div className="mt-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[10px] text-emerald-900">
                      ✓ Remembered: {m.rememberedTitle}
                    </div>
                  ) : null}
                  {m.learnedFacts?.map((fact) => (
                    <div
                      key={fact.id}
                      className="mt-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2 py-1.5 text-[10px] text-blue-900"
                    >
                      ✓ Learned: {fact.value}
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-zinc-100 p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void onSend();
              }
            }}
            placeholder="Message…"
            rows={1}
            className="max-h-[96px] min-h-[40px] flex-1 resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm leading-5 text-zinc-900 placeholder:text-zinc-500 focus:border-zinc-300 focus:bg-white focus:outline-none focus:ring-0"
            disabled={busy}
          />
          <button
            type="button"
            onClick={() => void onSend()}
            disabled={busy || text.trim().length === 0}
            className="shrink-0 rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {busy ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
