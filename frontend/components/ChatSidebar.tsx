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

function IconActivity({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}

function IconSend({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}

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
              ? `Ошибка: ${e.message}`
              : "Ошибка: не удалось связаться с сервером",
          rememberedTitle: null,
          learnedFacts: undefined,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden border-l border-white/5 bg-zinc-950/30 backdrop-blur-3xl">
      <header className="shrink-0 border-b border-white/5 px-6 py-6 sm:px-8">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-accent animate-pulse" />
            <div className="min-w-0">
              <span className="mono-label !tracking-[0.28em] !text-zinc-400 block">
                AIR4 CONSOLE
              </span>
              <p className="mt-2 truncate font-mono text-[10px] leading-tight tracking-tight text-zinc-600">
                {subtitle}
              </p>
            </div>
          </div>
          <IconActivity className="mt-0.5 h-3 w-3 shrink-0 text-zinc-600" />
        </div>
      </header>

      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-6 py-8 sm:px-8 sm:py-10"
      >
        {messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-4 py-12 text-center">
            <p className="mono-label text-zinc-600">Ожидание запроса</p>
            <p className="mt-3 max-w-[240px] text-sm font-light leading-relaxed text-zinc-500">
              Спроси AIR4 о финансах, событиях или следующем шаге.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-8">
            {messages.map((m, idx) =>
              m.role === "user" ? (
                <div
                  key={idx}
                  className="flex max-w-[100%] flex-col items-end self-end"
                >
                  <div className="rounded-lg border border-white/10 bg-zinc-800/90 px-5 py-4 text-[13px] font-medium leading-[1.6] text-zinc-100">
                    {m.content}
                  </div>
                </div>
              ) : (
                <div
                  key={idx}
                  className="flex max-w-[100%] flex-col items-start self-start"
                >
                  <div className="rounded-lg border border-white/5 bg-white/[0.03] px-5 py-4 text-[13px] leading-[1.6] text-zinc-300 backdrop-blur-sm">
                    {m.content}
                  </div>
                  {m.rememberedTitle ? (
                    <div className="mt-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[10px] leading-snug text-emerald-200">
                      ✓ Запомнил: {m.rememberedTitle}
                    </div>
                  ) : null}
                  {m.learnedFacts?.map((fact) => (
                    <div
                      key={fact.id}
                      className="mt-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-[10px] leading-snug text-blue-200"
                    >
                      ✓ Узнал: {fact.value}
                    </div>
                  ))}
                </div>
              )
            )}
            {busy ? (
              <div className="flex gap-1.5 px-1" aria-hidden>
                <span className="h-1 w-1 animate-bounce rounded-full bg-brand-accent" />
                <span className="h-1 w-1 animate-bounce rounded-full bg-brand-accent [animation-delay:120ms]" />
                <span className="h-1 w-1 animate-bounce rounded-full bg-brand-accent [animation-delay:240ms]" />
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-white/5 bg-zinc-950/50 px-6 py-6 backdrop-blur-md sm:px-8 sm:py-8">
        <div className="relative group">
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
            placeholder="Запрос к консоли…"
            rows={1}
            className="max-h-[96px] min-h-[80px] w-full resize-none rounded-lg border border-white/10 bg-white/[0.02] py-4 pl-5 pr-14 pb-11 text-[13px] leading-[1.6] text-zinc-200 placeholder:text-zinc-600 transition-all focus:border-brand-accent/40 focus:bg-white/[0.04] focus:outline-none focus:ring-0 disabled:opacity-50"
            disabled={busy}
          />
          <div className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-3">
            <span className="hidden text-[9px] font-mono text-zinc-600 opacity-0 transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 sm:block">
              Enter — отправить
            </span>
            <button
              type="button"
              onClick={() => void onSend()}
              disabled={busy || text.trim().length === 0}
              aria-label={busy ? "Отправка…" : "Отправить"}
              className="pointer-events-auto rounded-md bg-brand-accent p-2 text-white shadow-[0_0_20px_-6px_rgba(59,130,246,0.6)] transition-all hover:bg-brand-accent/90 active:scale-90 disabled:opacity-20"
            >
              <IconSend className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
