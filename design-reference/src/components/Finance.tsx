import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import {
  TrendingUp,
  TrendingDown,
  Upload,
  Utensils,
  ShoppingBag,
  Car,
  Zap,
  MoreHorizontal,
  Bell,
  Activity,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Trash2,
  Loader2,
  Sparkles,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../lib/utils";
import { t } from "../lib/typography";
import { Page } from "../types";
import {
  deleteUpload,
  fetchFinanceCycles,
  fetchMonthlyFixed,
  fetchObligations,
  fetchSubscriptions,
  formatCategoryLabel,
  formatEuro,
  getInsights,
  getSummary,
  getTransactions,
  getUploads,
  hasFinanceData,
  type FinanceCycles,
  type FinanceObligation,
  type FinanceSubscription,
  type Insight,
  type MonthlyFixed,
  type StatementUpload,
  type Summary,
  type Transaction,
} from "../lib/api";

const StatusDot = ({ color = "#ef4444" }: { color?: string }) => (
  <div className="absolute top-3 right-3 w-4 h-4 flex items-center justify-center pointer-events-none">
    <div
      className="absolute w-4 h-4 rounded-full opacity-50 animate-ping"
      style={{ backgroundColor: color }}
    />
    <div className="relative w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
  </div>
);

const CATEGORY_ICONS: Record<string, { icon: LucideIcon; color: string }> = {
  food_restaurants: { icon: Utensils, color: "bg-red-500" },
  food_groceries: { icon: ShoppingBag, color: "bg-emerald-500" },
  transport: { icon: Car, color: "bg-blue-500" },
  subscriptions: { icon: Zap, color: "bg-amber-500" },
  health: { icon: Activity, color: "bg-teal-500" },
  shopping: { icon: CreditCard, color: "bg-indigo-500" },
  transfers: { icon: MoreHorizontal, color: "bg-gray-400" },
  utilities: { icon: Zap, color: "bg-sky-500" },
  entertainment: { icon: Activity, color: "bg-purple-500" },
  other: { icon: MoreHorizontal, color: "bg-gray-300" },
};

function categoryMeta(key: string) {
  return (
    CATEGORY_ICONS[key] ?? {
      icon: MoreHorizontal,
      color: "bg-gray-300",
    }
  );
}

function formatTxDate(iso: string): string {
  const d = new Date(iso.includes("T") ? iso : `${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function formatUploadDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatPeriod(start: string | null | undefined, end: string | null | undefined): string {
  if (start && end) return `${start} — ${end}`;
  if (start) return start;
  if (end) return end;
  return "—";
}

function formatCycleEdge(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Salary cycle starts on the 10th. Given a cycle-start ISO, return the
 *  start of the previous cycle (subtract 1 month, handle Jan → Dec). */
function prevCycleStart(startIso: string): string {
  const [y, m] = startIso.split("-").map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, "0")}-10`;
}

/** Start of the next cycle (add 1 month). */
function nextCycleStart(startIso: string): string {
  const [y, m] = startIso.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-10`;
}

/** Cycle end is the 9th of the next month after `startIso`. */
function cycleEndFromStart(startIso: string): string {
  const [y, m] = startIso.split("-").map(Number);
  const ey = m === 12 ? y + 1 : y;
  const em = m === 12 ? 1 : m + 1;
  return `${ey}-${String(em).padStart(2, "0")}-09`;
}

function ChatEmpty({ label }: { label: string }) {
  return (
    <p className="text-[13px] text-[#9ca3af] font-medium py-4 text-center">
      {label}
      <span className="block text-[11px] mt-1 text-[#d1d5db]">Добавить через чат</span>
    </p>
  );
}

/** Resolve a recurring `billing_day` (1-31) to the next calendar date
 *  on or after today. Returns null when the day is missing/invalid. */
function nextBillingDate(
  billingDay: number | null | undefined,
  today: Date = new Date()
): Date | null {
  if (billingDay == null || !Number.isFinite(billingDay)) return null;
  const day = Math.max(1, Math.min(28, Math.trunc(billingDay)));
  const y = today.getFullYear();
  const m = today.getMonth();
  const todayDay = today.getDate();
  return todayDay <= day ? new Date(y, m, day) : new Date(y, m + 1, day);
}

/** Pull a day-of-month out of an obligation's `due_date` field, which is a
 *  free-form text column. Accepts ISO YYYY-MM-DD or a bare 1-2 digit number. */
function parseDueDay(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return Number(iso[3]);
  const day = /^(\d{1,2})$/.exec(s);
  if (day) {
    const n = Number(day[1]);
    return n >= 1 && n <= 31 ? n : null;
  }
  return null;
}

function formatRelativeDate(date: Date, today: Date = new Date()): string {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((date.getTime() - start.getTime()) / 86_400_000);
  if (days <= 0) return "сегодня";
  if (days === 1) return "завтра";
  if (days < 7) return `через ${days} дн`;
  return date.toLocaleDateString("ru-RU", { month: "short", day: "numeric" });
}

/** Pick a Tailwind class set for a loan progress bar based on % paid.
 *  Mostly paid → green; halfway → indigo; mostly remaining → red. */
function progressTone(percentPaid: number): {
  bar: string;
  text: string;
  badge: string;
} {
  if (percentPaid >= 70) {
    return {
      bar: "bg-emerald-500",
      text: "text-emerald-600",
      badge: "bg-emerald-50 text-emerald-700",
    };
  }
  if (percentPaid >= 35) {
    return {
      bar: "bg-indigo-500",
      text: "text-indigo-600",
      badge: "bg-indigo-50 text-indigo-700",
    };
  }
  return {
    bar: "bg-red-500",
    text: "text-red-600",
    badge: "bg-red-50 text-red-700",
  };
}

export function Finance({
  onPageChange,
  refreshTick = 0,
}: {
  onPageChange: (page: Page) => void;
  refreshTick?: number;
}) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [uploads, setUploads] = useState<StatementUpload[]>([]);
  const [subscriptions, setSubscriptions] = useState<FinanceSubscription[]>([]);
  const [obligations, setObligations] = useState<FinanceObligation[]>([]);
  const [monthlyFixed, setMonthlyFixed] = useState<MonthlyFixed | null>(null);
  const [cycles, setCycles] = useState<FinanceCycles | null>(null);
  const [cycleStart, setCycleStart] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const cycleEnd = cycleStart ? cycleEndFromStart(cycleStart) : null;

  /** Load everything that isn't cycle-scoped (transactions list, uploads,
   *  insights, recurring items) + the cycle metadata. */
  const loadStaticData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [
      cyclesRes,
      txRes,
      insightsRes,
      uploadsRes,
      subsRes,
      obsRes,
      fixedRes,
    ] = await Promise.allSettled([
      fetchFinanceCycles(),
      getTransactions(10),
      getInsights(),
      getUploads(),
      fetchSubscriptions(),
      fetchObligations(),
      fetchMonthlyFixed(),
    ]);

    const failed: string[] = [];

    if (cyclesRes.status === "fulfilled") {
      setCycles(cyclesRes.value);
      // Default to latest cycle that actually has data, fall back to today's
      // active cycle when no transactions exist yet.
      const initial =
        cyclesRes.value.latest_with_data?.start ?? cyclesRes.value.active.start;
      setCycleStart((prev) => prev ?? initial);
    } else {
      setCycles(null);
      failed.push("cycles");
    }

    if (txRes.status === "fulfilled") {
      setTransactions(txRes.value.items);
    } else {
      setTransactions([]);
      failed.push("transactions");
    }

    if (insightsRes.status === "fulfilled") {
      setInsights(insightsRes.value);
    } else {
      setInsights([]);
      failed.push("insights");
    }

    if (uploadsRes.status === "fulfilled") {
      setUploads(uploadsRes.value);
    } else {
      setUploads([]);
      failed.push("uploads");
    }

    if (subsRes.status === "fulfilled") {
      setSubscriptions(subsRes.value.subscriptions);
    } else {
      setSubscriptions([]);
    }

    if (obsRes.status === "fulfilled") {
      setObligations(obsRes.value.obligations);
    } else {
      setObligations([]);
    }

    if (fixedRes.status === "fulfilled") {
      setMonthlyFixed(fixedRes.value);
    } else {
      setMonthlyFixed(null);
    }

    if (failed.length > 0) {
      setError(`Не удалось загрузить: ${failed.join(", ")}`);
    }

    setLoading(false);
  }, []);

  /** Refetch summary whenever the selected cycle changes. */
  useEffect(() => {
    if (!cycleStart || !cycleEnd) return;
    let cancelled = false;
    void getSummary(cycleStart, cycleEnd)
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch(() => {
        if (!cancelled) setSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [cycleStart, cycleEnd]);

  useEffect(() => {
    void loadStaticData();
  }, [loadStaticData]);

  /** Refetch subscriptions / obligations / monthly-fixed when the chat
   *  reports that a recurring item was updated or deleted. Skip the initial
   *  mount (tick === 0) since loadStaticData already covers that. */
  useEffect(() => {
    if (refreshTick === 0) return;
    let cancelled = false;
    void Promise.allSettled([
      fetchSubscriptions(),
      fetchObligations(),
      fetchMonthlyFixed(),
    ]).then(([subsRes, obsRes, fixedRes]) => {
      if (cancelled) return;
      if (subsRes.status === "fulfilled") {
        setSubscriptions(subsRes.value.subscriptions);
      }
      if (obsRes.status === "fulfilled") {
        setObligations(obsRes.value.obligations);
      }
      if (fixedRes.status === "fulfilled") {
        setMonthlyFixed(fixedRes.value);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  const canGoForward = Boolean(
    cycleStart && cycles && cycleStart < cycles.active.start
  );
  const canGoBack = Boolean(
    cycleStart &&
      cycles?.earliest_with_data &&
      cycleStart > cycles.earliest_with_data.start
  );

  const handlePrevCycle = () => {
    if (!cycleStart || !canGoBack) return;
    setCycleStart(prevCycleStart(cycleStart));
  };

  const handleNextCycle = () => {
    if (!cycleStart || !canGoForward) return;
    setCycleStart(nextCycleStart(cycleStart));
  };

  const handleDeleteUpload = async (uploadId: number) => {
    if (!window.confirm("Удалить эту выписку и все её транзакции?")) return;
    setDeletingId(uploadId);
    setError(null);
    try {
      await deleteUpload(uploadId);
      await loadStaticData();
      if (cycleStart && cycleEnd) {
        try {
          setSummary(await getSummary(cycleStart, cycleEnd));
        } catch {
          setSummary(null);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось удалить выписку");
    } finally {
      setDeletingId(null);
    }
  };

  const hasData =
    hasFinanceData(summary) ||
    transactions.length > 0 ||
    uploads.length > 0;

  const categories = useMemo(() => {
    if (!summary?.by_category) return [];
    const entries = Object.entries(summary.by_category).sort(
      (a, b) => b[1].amount - a[1].amount
    );
    const max = entries[0]?.[1].amount ?? 1;
    const rows = entries.map(([key, val]) => {
      const meta = categoryMeta(key);
      return {
        key,
        name: formatCategoryLabel(key),
        amount: val.amount,
        count: val.count,
        percent: Math.round((val.amount / max) * 100),
        icon: meta.icon,
        color: meta.color,
        highlight: key === "subscriptions" || key === "food_restaurants",
        isInternal: false,
      };
    });

    const internal = summary.internal_transfers;
    if (internal && internal.count > 0) {
      const scale = Math.max(max, internal.amount, 1);
      rows.push({
        key: "internal_transfers",
        name: "Внутренние переводы",
        amount: internal.amount,
        count: internal.count,
        percent: Math.round((internal.amount / scale) * 100),
        icon: MoreHorizontal,
        color: "bg-gray-300",
        highlight: false,
        isInternal: true,
      });
    }

    return rows;
  }, [summary]);

  const income = summary?.total_income ?? 0;
  const spent = summary?.total_spent ?? 0;
  const otherIncoming = summary?.other_incoming ?? null;
  const freeCapital = income - spent;
  const primaryInsight = insights[0] ?? null;

  /** Merge subscriptions + obligations into a single chronological list of
   *  next payments. Items without a usable day-of-month are skipped. */
  const upcomingPayments = useMemo(() => {
    const today = new Date();
    type Upcoming = {
      key: string;
      kind: "subscription" | "obligation";
      name: string;
      amount: number | null;
      date: Date;
    };
    const items: Upcoming[] = [];

    for (const s of subscriptions) {
      const date = nextBillingDate(s.billing_day, today);
      if (!date) continue;
      items.push({
        key: `sub-${s.id}`,
        kind: "subscription",
        name: s.name,
        amount: s.amount,
        date,
      });
    }

    for (const o of obligations) {
      const day = parseDueDay(o.due_date);
      const date = nextBillingDate(day, today);
      if (!date) continue;
      items.push({
        key: `obl-${o.id}`,
        kind: "obligation",
        name: o.name,
        amount: o.monthly_payment,
        date,
      });
    }

    items.sort((a, b) => a.date.getTime() - b.date.getTime());
    return items.slice(0, 6);
  }, [subscriptions, obligations]);

  return (
    <div className="flex flex-col gap-8 pb-10">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-green-50 text-green-600 rounded-xl">
            <Wallet size={22} className="fill-green-100" />
          </div>
          <div>
            <h1 className={t.pageTitle}>
              Финансовый обзор
            </h1>
            <p className={cn(t.pageSub, "mt-0.5")}>
              Расходы, доходы и финансовый трекинг
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 bg-green-50/50 border border-green-100 px-3.5 py-1.5 rounded-xl">
            <Sparkles size={14} className="text-green-600" />
            <span className="text-xs font-bold text-green-700">Финансовый советник</span>
          </div>

          <button
            type="button"
            onClick={() => onPageChange("CSVUpload")}
            className="flex items-center gap-2 bg-[#6366f1] text-white px-4 py-2 rounded-xl font-bold text-[12px] shadow-md shadow-indigo-500/20 hover:bg-indigo-700 transition-all uppercase tracking-wider"
          >
            <Upload size={14} />
            Загрузить выписку
          </button>
        </div>
      </div>

      {error && (
        <p className="text-[14px] text-red-500 bg-red-50 px-4 py-3 rounded-xl">{error}</p>
      )}

      {loading ? (
        <p className="text-[14px] text-[#9ca3af]">Загрузка…</p>
      ) : !hasData ? (
        <div className="bg-white rounded-[20px] p-12 shadow-[0_2px_12px_rgba(0,0,0,0.08)] text-center">
          <p className="text-[16px] font-bold text-[#111827]">Выписки пока не загружены</p>
          <p className="text-[13px] text-[#9ca3af] mt-2">
            Загрузите CSV Swedbank, чтобы увидеть свои финансы.
          </p>
          <button
            type="button"
            onClick={() => onPageChange("CSVUpload")}
            className="mt-6 inline-flex items-center gap-2 bg-[#6366f1] text-white px-5 py-2.5 rounded-[10px] font-bold text-[13px]"
          >
            <Upload size={16} />
            Загрузить выписку
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-5 gap-6">
          <div className="col-span-3 space-y-6">
            <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
              <div className="flex items-center justify-between gap-4 mb-6">
                <h2 className={t.cardLabel}>Срез месяца</h2>
                {cycleStart && cycleEnd && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handlePrevCycle}
                      disabled={!canGoBack}
                      aria-label="Предыдущий цикл"
                      className="p-1 rounded-full text-gray-500 hover:bg-gray-100 hover:text-indigo-600 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-500 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <span className="text-[11px] font-bold text-gray-700 font-mono tabular-nums tracking-wide min-w-[120px] text-center">
                      {formatCycleEdge(cycleStart)} – {formatCycleEdge(cycleEnd)}
                    </span>
                    <button
                      type="button"
                      onClick={handleNextCycle}
                      disabled={!canGoForward}
                      aria-label="Следующий цикл"
                      className="p-1 rounded-full text-gray-500 hover:bg-gray-100 hover:text-indigo-600 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-500 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-8">
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Доход</p>
                  <p className="font-mono text-2xl font-bold text-gray-900">{formatEuro(income)}</p>
                  <p className="text-[10px] font-bold text-gray-300 uppercase tracking-wider mt-1">
                    Зарплата и доверенные источники
                  </p>
                  {otherIncoming && otherIncoming.amount > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-100">
                      <p className="text-[10px] font-bold text-gray-400 uppercase mb-0.5">
                        Прочие поступления
                      </p>
                      <p className="font-mono text-[15px] font-semibold text-gray-500">
                        {formatEuro(otherIncoming.amount)}
                        <span className="ml-1.5 text-[10px] font-medium text-gray-400">
                          ({otherIncoming.count})
                        </span>
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        Переводы, возвраты — не учитываются в свободном капитале
                      </p>
                    </div>
                  )}
                </div>
                <div className="bg-indigo-50/50 p-4 rounded-2xl border border-indigo-100/50">
                  <p className="text-[10px] font-bold text-indigo-400 uppercase mb-1">
                    Свободный капитал
                  </p>
                  <div className="flex items-center gap-2 text-indigo-600">
                    <p className="font-mono text-3xl font-black">{formatEuro(freeCapital)}</p>
                    {freeCapital >= 0 ? (
                      <TrendingUp size={20} />
                    ) : (
                      <TrendingDown size={20} className="text-red-500" />
                    )}
                  </div>
                  <p className="text-[10px] font-black text-indigo-600/60 uppercase mt-1">
                    Доход − расходы
                  </p>
                  <p className="text-[10px] text-[#9ca3af] mt-2">Потрачено: {formatEuro(spent)}</p>
                  {monthlyFixed && monthlyFixed.fixed_total > 0 && (
                    <p className="text-[10px] text-[#9ca3af] mt-1">
                      Постоянные расходы: {formatEuro(monthlyFixed.fixed_total)}/мес
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)] relative">
              {categories.length > 0 && <StatusDot color="#ef4444" />}
              <h2 className={cn(t.cardLabel, "mb-6")}>
                Расходы по категориям
              </h2>
              {categories.length === 0 ? (
                <p className="text-[14px] text-[#9ca3af]">Категорий расходов пока нет.</p>
              ) : (
                <div className="space-y-5">
                  {categories.map((cat) => (
                    <div key={cat.key} className="space-y-2">
                      <div className="flex justify-between items-center text-[13px] font-medium">
                        <div
                          className={cn(
                            "flex items-center gap-2",
                            cat.isInternal ? "text-gray-400" : "text-gray-700"
                          )}
                        >
                          <cat.icon
                            size={14}
                            className={cn(
                              cat.highlight ? "text-amber-500" : "text-gray-400"
                            )}
                          />
                          {cat.name}
                          <span className="text-[10px] text-[#9ca3af]">({cat.count})</span>
                          {cat.isInternal && (
                            <span className="text-[10px] text-gray-400 font-normal normal-case tracking-normal">
                              не реальные траты
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-gray-900 font-bold">
                            {formatEuro(cat.amount)}
                          </span>
                          <span className="text-gray-400 font-mono text-[11px] w-8 text-right">
                            {cat.percent}%
                          </span>
                        </div>
                      </div>
                      <div className="h-2 w-full bg-gray-50 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${cat.percent}%` }}
                          transition={{ duration: 1, ease: "easeOut" }}
                          className={cn("h-full rounded-full", cat.color)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
              <h2 className={cn(t.cardLabel, "mb-6")}>
                Недавние транзакции
              </h2>
              {transactions.length === 0 ? (
                <p className="text-[14px] text-[#9ca3af]">Транзакций не найдено.</p>
              ) : (
                <div className="overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                        <th className="pb-4">Дата</th>
                        <th className="pb-4">Контрагент</th>
                        <th className="pb-4 text-right">Сумма</th>
                        <th className="pb-4 pl-8">Категория</th>
                      </tr>
                    </thead>
                    <tbody className="text-[13px]">
                      {transactions.map((t, i) => {
                        const isIncome = !t.is_debit;
                        const signed = isIncome ? t.amount : -t.amount;
                        return (
                          <tr
                            key={t.id}
                            className={cn("group", i % 2 === 0 ? "bg-gray-50/30" : "bg-white")}
                          >
                            <td className="py-3 font-mono text-gray-400">
                              {formatTxDate(t.date)}
                            </td>
                            <td className="py-3 font-bold text-gray-900 max-w-[200px] truncate">
                              {t.description || "—"}
                            </td>
                            <td
                              className={cn(
                                "py-3 font-mono font-bold text-right",
                                isIncome ? "text-green-600" : "text-gray-900"
                              )}
                            >
                              {signed > 0 ? "+" : ""}
                              {formatEuro(Math.abs(signed))}
                            </td>
                            <td className="py-3 pl-8">
                              <span
                                className={cn(
                                  "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-tighter",
                                  isIncome
                                    ? "bg-green-50 text-green-600"
                                    : "bg-gray-100 text-gray-500"
                                )}
                              >
                                {formatCategoryLabel(t.category || "other")}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className="col-span-2 space-y-6">
            <div className="bg-[#1a1a2e] rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)] border-l-[4px] border-indigo-500 min-h-[120px]">
              <div className="flex gap-3 text-white">
                <div className="shrink-0 w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center">
                  <Bell size={16} />
                </div>
                {primaryInsight ? (
                  <div>
                    <p className="text-[11px] font-bold text-indigo-300 uppercase tracking-wider mb-1">
                      {primaryInsight.title}
                    </p>
                    <p className="text-[15px] leading-relaxed font-medium text-white/90">
                      {primaryInsight.description}
                    </p>
                  </div>
                ) : (
                  <p className="text-[14px] leading-relaxed text-white/50">
                    Озарений пока нет. Продолжайте использовать AIR4 — паттерны появятся здесь.
                  </p>
                )}
              </div>
            </div>

            <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
              <div className="flex items-baseline justify-between mb-4">
                <h2 className={t.cardLabel}>Предстоящие платежи</h2>
                {upcomingPayments.length > 0 && (
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                    Ближайшие {upcomingPayments.length}
                  </span>
                )}
              </div>
              {upcomingPayments.length === 0 ? (
                <ChatEmpty label="Запланированных платежей нет" />
              ) : (
                <ul className="divide-y divide-gray-50">
                  {upcomingPayments.map((p) => (
                    <li
                      key={p.key}
                      className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={cn(
                            "shrink-0 w-9 h-9 rounded-xl flex flex-col items-center justify-center text-[9px] font-bold uppercase tracking-wider",
                            p.kind === "subscription"
                              ? "bg-amber-50 text-amber-700"
                              : "bg-indigo-50 text-indigo-700"
                          )}
                        >
                          <span className="text-[10px] leading-none">
                            {p.date.toLocaleDateString("ru-RU", { month: "short" })}
                          </span>
                          <span className="font-mono text-[12px] leading-none mt-0.5">
                            {p.date.getDate()}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <p className="text-[13px] font-bold text-gray-900 truncate">
                            {p.name}
                          </p>
                          <p className="text-[10px] text-gray-400 font-mono mt-0.5">
                            {formatRelativeDate(p.date)}
                          </p>
                        </div>
                      </div>
                      <span className="font-mono text-[13px] font-bold text-gray-900 shrink-0">
                        {p.amount != null ? formatEuro(p.amount) : "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
              <div className="flex items-baseline justify-between mb-4">
                <h2 className={t.cardLabel}>Подписки</h2>
                {subscriptions.length > 0 && monthlyFixed && (
                  <span className="text-[11px] font-mono font-bold text-indigo-600">
                    {formatEuro(monthlyFixed.subscriptions_total)}/мес
                  </span>
                )}
              </div>
              {subscriptions.length === 0 ? (
                <ChatEmpty label="Подписки не отслеживаются" />
              ) : (
                <ul className="divide-y divide-gray-50">
                  {subscriptions.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-baseline justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <p className="text-[13px] font-bold text-gray-900 truncate">
                          {s.name}
                        </p>
                        {s.billing_day != null && (
                          <p className="text-[10px] text-gray-400 font-mono mt-0.5">
                            {s.billing_day}-е число
                          </p>
                        )}
                      </div>
                      <span className="font-mono text-[13px] font-bold text-gray-900 shrink-0">
                        {s.amount != null ? `${formatEuro(s.amount)}/мес` : "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
              <div className="flex items-baseline justify-between mb-4">
                <h2 className={t.cardLabel}>Кредиты и обязательства</h2>
                {obligations.length > 0 && monthlyFixed && (
                  <span className="text-[11px] font-mono font-bold text-indigo-600">
                    {formatEuro(monthlyFixed.obligations_total)}/мес
                  </span>
                )}
              </div>
              {obligations.length === 0 ? (
                <ChatEmpty label="Кредитов нет" />
              ) : (
                <ul className="space-y-5">
                  {obligations.map((o) => {
                    const total = o.total_amount;
                    const remaining = o.remaining_amount;
                    const hasProgress =
                      total != null &&
                      total > 0 &&
                      remaining != null &&
                      remaining >= 0;
                    const paid = hasProgress
                      ? Math.max(0, (total as number) - (remaining as number))
                      : 0;
                    const percentPaid = hasProgress
                      ? Math.min(100, Math.round((paid / (total as number)) * 100))
                      : 0;
                    const tone = progressTone(percentPaid);
                    return (
                      <li
                        key={o.id}
                        className="space-y-2 first:pt-0 last:pb-0"
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="text-[13px] font-bold text-gray-900 truncate">
                            {o.name}
                          </p>
                          <span className="font-mono text-[13px] font-bold text-gray-900 shrink-0">
                            {o.monthly_payment != null
                              ? `${formatEuro(o.monthly_payment)}/мес`
                              : "—"}
                          </span>
                        </div>
                        {hasProgress ? (
                          <>
                            <div className="h-2 w-full bg-gray-50 rounded-full overflow-hidden">
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${percentPaid}%` }}
                                transition={{ duration: 1, ease: "easeOut" }}
                                className={cn("h-full rounded-full", tone.bar)}
                              />
                            </div>
                            <div className="flex items-center justify-between text-[10px] font-mono text-gray-400">
                              <span>
                                выплачено{" "}
                                <span className={cn("font-bold", tone.text)}>
                                  {formatEuro(paid)}
                                </span>{" "}
                                / {formatEuro(total as number)}
                              </span>
                              <span
                                className={cn(
                                  "px-1.5 py-0.5 rounded-md font-bold uppercase tracking-wider",
                                  tone.badge
                                )}
                              >
                                {percentPaid}% выплачено
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-gray-400 font-mono">
                              <span>осталось {formatEuro(remaining as number)}</span>
                              {o.interest_rate != null && (
                                <span>{o.interest_rate.toFixed(1)}%</span>
                              )}
                              {o.due_date && <span>срок {o.due_date}</span>}
                            </div>
                          </>
                        ) : (
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-gray-400 font-mono">
                            {remaining != null && (
                              <span>осталось {formatEuro(remaining)}</span>
                            )}
                            {o.interest_rate != null && (
                              <span>{o.interest_rate.toFixed(1)}%</span>
                            )}
                            {o.due_date && <span>срок {o.due_date}</span>}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
        <h2 className={cn(t.cardLabel, "mb-6")}>
          Загруженные выписки
        </h2>
        {loading && uploads.length === 0 ? (
          <p className="text-[14px] text-[#9ca3af]">Загрузка…</p>
        ) : uploads.length === 0 ? (
          <p className="text-[14px] text-[#9ca3af]">Выписки пока не загружены.</p>
        ) : (
          <ul className="divide-y divide-gray-50">
            {uploads.map((up) => (
              <li
                key={up.id}
                className="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-bold text-[#111827] truncate">{up.filename}</p>
                  <p className="text-[12px] text-[#6b7280] font-mono mt-1">
                    {formatPeriod(up.period_start, up.period_end)}
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] text-[#9ca3af] font-bold uppercase tracking-wider">
                    <span>{up.total_transactions} транзакций</span>
                    <span>Загружено {formatUploadDate(up.created_at)}</span>
                    {up.account_iban && (
                      <span className="font-mono normal-case tracking-normal">{up.account_iban}</span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleDeleteUpload(up.id)}
                  disabled={deletingId === up.id}
                  className="shrink-0 p-2.5 rounded-xl text-red-500 hover:bg-red-50 disabled:opacity-50 transition-colors"
                  aria-label={`Удалить ${up.filename}`}
                >
                  {deletingId === up.id ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <Trash2 size={18} />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
