"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  getCrossSphereInsights,
  chat,
  getObservations,
  getProfile,
  getSummary,
  getTransactions,
  getPendingFollowups,
  getHypotheses,
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
  let monthlyIncome: number | null = null;
  try {
    const profile = await getProfile();
    if (profile.name?.trim()) name = profile.name.trim();
    monthlyIncome =
      typeof profile.monthly_income === "number" ? profile.monthly_income : null;
  } catch {
    /* keep fallback */
  }

  async function buildSmartGreeting(opts: {
    includeCrossSphere?: boolean;
    defaultText: string;
    noDataText?: string;
  }): Promise<string> {
    const results = await Promise.allSettled([
      getObservations(),
      getPendingFollowups(),
      getHypotheses(),
      getSummary(),
      opts.includeCrossSphere ? getCrossSphereInsights() : Promise.resolve([]),
    ]);

    const obs = results[0].status === "fulfilled" ? results[0].value : [];
    const pendingFollowups =
      results[1].status === "fulfilled" ? results[1].value : [];
    const hypotheses = results[2].status === "fulfilled" ? results[2].value : [];
    const summary = results[3].status === "fulfilled" ? results[3].value : null;
    const crossSphere =
      results[4].status === "fulfilled" ? results[4].value : [];

    const unreadObs = (obs || []).filter((o) => !o.is_read);
    if (unreadObs.length > 0) {
      const top = unreadObs[0];
      return `${name}, заметил кое-что важное: ${top.title}. Хочешь разобрать?`;
    }

    if (opts.includeCrossSphere && (crossSphere || []).length > 0) {
      const top = (crossSphere || [])[0];
      if (top?.title) {
        return `Заметил связь: ${top.title}. Хочешь разобрать?`;
      }
    }

    if ((pendingFollowups || []).length > 0) {
      return `Есть дилемма которая ждёт твоего ответа. Как пошло?`;
    }

    const pendingHypotheses = (hypotheses || []).filter((h) => h.status === "pending");
    if (pendingHypotheses.length > 0) {
      const n = pendingHypotheses.length;
      return `У тебя ${n} гипотез${n % 10 === 1 && n % 100 !== 11 ? "а" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? "ы" : ""} которые я хочу проверить. Зайди в Паттерны.`;
    }

    const noData =
      summary == null ||
      summary.upload_id == null ||
      (summary.total_spent === 0 && (summary.by_category || []).length === 0);
    if (noData) {
      return opts.noDataText || "Загрузи выписку чтобы я начал анализировать.";
    }

    if (summary && monthlyIncome && monthlyIncome > 0) {
      const total = Number(summary.total_spent || 0);
      const threshold = monthlyIncome * 1.2;
      if (total > threshold) {
        const pct = ((total / monthlyIncome - 1) * 100);
        return `В последнем периоде ты потратил €${total.toFixed(
          2
        )} при доходе €${monthlyIncome.toFixed(2)}. Это на ${pct.toFixed(0)}% выше дохода.`;
      }
    }

    return opts.defaultText;
  }

  if (pathname.startsWith("/dashboard")) {
    const defaultText = `Привет, ${name}! Что хочешь разобрать?`;
    return await buildSmartGreeting({ includeCrossSphere: true, defaultText });
  }
  if (pathname.startsWith("/events")) {
    return `Привет, ${name}! Здесь твои жизненные события. Хочешь добавить что-то новое или найти связи с тратами?`;
  }
  if (pathname.startsWith("/timeline")) {
    return `Привет, ${name}! Здесь твои траты по периодам. Выбери два периода для сравнения.`;
  }
  if (pathname.startsWith("/projects")) {
    return `Привет, ${name}! Здесь твои проекты. Расскажи что сейчас в работе или обнови статус.`;
  }
  if (pathname.startsWith("/hypotheses")) {
    return `Привет, ${name}! Здесь гипотезы которые я хочу проверить с тобой. Подтверди или отклони.`;
  }
  if (pathname.startsWith("/facts")) {
    return `Привет, ${name}! Здесь всё что я знаю о тебе. Можешь удалить неверное или рассказать больше.`;
  }
  if (pathname.startsWith("/dilemmas")) {
    try {
      const pf = await getPendingFollowups();
      if ((pf || []).length > 0) {
        return `Привет, ${name}! Есть дилемма которая ждёт фоллоу-апа. Как пошло?`;
      }
    } catch {
      /* ignore */
    }
    return `Привет, ${name}! Опиши дилемму — разложу по полочкам с учётом твоего контекста.`;
  }
  if (pathname.startsWith("/interview")) {
    return `Привет, ${name}! Отвечай честно — чем больше контекста, тем точнее мои советы.`;
  }
  if (pathname.startsWith("/profile")) {
    return `Привет, ${name}! Здесь твой профиль — обнови данные, и я смогу точнее советовать по финансам.`;
  }
  if (pathname === "/" || pathname === "") {
    const defaultText = `Привет, ${name}! Это твой обзор жизни. Что хочешь разобрать сегодня?`;
    return await buildSmartGreeting({
      defaultText,
      noDataText: "Загрузи выписку чтобы я начал анализировать",
    });
  }
  if (pathname.startsWith("/upload")) {
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

  useEffect(() => {
    function onPrefill(e: Event) {
      const ce = e as CustomEvent<{ message?: string }>;
      const msg = ce.detail?.message;
      if (typeof msg === "string") setText(msg);
    }
    window.addEventListener("air4-chat-prefill", onPrefill as EventListener);
    return () =>
      window.removeEventListener("air4-chat-prefill", onPrefill as EventListener);
  }, []);

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
      setMessages((prev) => {
        const nextGreeting: ChatLine = { role: "assistant", content };
        if (prev.length === 0) return [nextGreeting];
        if (prev[0]?.role === "assistant") {
          return [nextGreeting, ...prev.slice(1)];
        }
        return [nextGreeting, ...prev];
      });
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
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-zinc-50">
      <header className="flex h-14 shrink-0 flex-col justify-center border-b border-zinc-200 bg-white px-4 leading-tight shadow-sm">
        <h2 className="text-sm font-semibold text-zinc-900">AIR4</h2>
        <p className="mt-0.5 truncate text-xs text-zinc-400">{subtitle}</p>
      </header>

      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-4 py-3"
      >
        {messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-2 py-8 text-center text-sm text-zinc-500">
            Спроси AIR4 о своих финансах
          </div>
        ) : (
          <div className="flex flex-col gap-3">
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
                      ✓ Запомнил: {m.rememberedTitle}
                    </div>
                  ) : null}
                  {m.learnedFacts?.map((fact) => (
                    <div
                      key={fact.id}
                      className="mt-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2 py-1.5 text-[10px] text-blue-900"
                    >
                      ✓ Узнал: {fact.value}
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-zinc-200 bg-white p-3">
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
            placeholder="Сообщение..."
            rows={1}
            className="max-h-[96px] min-h-[40px] flex-1 resize-none rounded-xl border-0 bg-zinc-100 px-3 py-2 text-sm leading-5 text-zinc-900 placeholder:text-zinc-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-zinc-300"
            disabled={busy}
          />
          <button
            type="button"
            onClick={() => void onSend()}
            disabled={busy || text.trim().length === 0}
            className="shrink-0 rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {busy ? "Отправляю..." : "Отправить"}
          </button>
        </div>
      </div>
    </div>
  );
}
