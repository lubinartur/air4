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
  CreditCard,
  Trash2,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../lib/utils";
import { Page } from "../types";
import {
  deleteUpload,
  formatCategoryLabel,
  formatEuro,
  getInsights,
  getSummary,
  getTransactions,
  getUploads,
  hasFinanceData,
  type Insight,
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

function ChatEmpty({ label }: { label: string }) {
  return (
    <p className="text-[13px] text-[#9ca3af] font-medium py-4 text-center">
      {label}
      <span className="block text-[11px] mt-1 text-[#d1d5db]">Add via chat</span>
    </p>
  );
}

export function Finance({ onPageChange }: { onPageChange: (page: Page) => void }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [uploads, setUploads] = useState<StatementUpload[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const loadFinanceData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [summaryRes, txRes, insightsRes, uploadsRes] = await Promise.allSettled([
      getSummary(),
      getTransactions(10),
      getInsights(),
      getUploads(),
    ]);

    const failed: string[] = [];

    if (summaryRes.status === "fulfilled") {
      setSummary(summaryRes.value);
    } else {
      setSummary(null);
      failed.push("summary");
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

    if (failed.length > 0) {
      setError(`Failed to load: ${failed.join(", ")}`);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    void loadFinanceData();
  }, [loadFinanceData]);

  const handleDeleteUpload = async (uploadId: number) => {
    if (!window.confirm("Удалить эту выписку и все её транзакции?")) return;
    setDeletingId(uploadId);
    setError(null);
    try {
      await deleteUpload(uploadId);
      await loadFinanceData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete upload");
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
        name: "Internal transfers",
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
  const freeCapital = income - spent;
  const primaryInsight = insights[0] ?? null;

  return (
    <div className="flex flex-col gap-8 pb-10">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-4xl font-black text-gray-900 tracking-tight">Finance</h1>
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.2em] mt-1">
            Financial Advisor
          </p>
          {summary?.period_start && summary?.period_end && (
            <p className="text-[11px] text-[#9ca3af] mt-2 font-mono">
              {summary.period_start} — {summary.period_end}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => onPageChange("CSVUpload")}
          className="flex items-center gap-2 bg-[#6366f1] text-white px-5 py-2.5 rounded-[10px] font-bold text-[13px] shadow-lg shadow-indigo-500/20 hover:bg-indigo-700 transition-all uppercase tracking-wider"
        >
          <Upload size={18} />
          Upload statement
        </button>
      </div>

      {error && (
        <p className="text-[14px] text-red-500 bg-red-50 px-4 py-3 rounded-xl">{error}</p>
      )}

      {loading ? (
        <p className="text-[14px] text-[#9ca3af]">Loading…</p>
      ) : !hasData ? (
        <div className="bg-white rounded-[20px] p-12 shadow-[0_2px_12px_rgba(0,0,0,0.08)] text-center">
          <p className="text-[16px] font-bold text-[#111827]">No statements uploaded yet</p>
          <p className="text-[13px] text-[#9ca3af] mt-2">
            Upload a Swedbank CSV to see your finances here.
          </p>
          <button
            type="button"
            onClick={() => onPageChange("CSVUpload")}
            className="mt-6 inline-flex items-center gap-2 bg-[#6366f1] text-white px-5 py-2.5 rounded-[10px] font-bold text-[13px]"
          >
            <Upload size={16} />
            Upload statement
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-5 gap-6">
          <div className="col-span-3 space-y-6">
            <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
              <h2 className="text-[11px] font-bold text-[#9ca3af] uppercase tracking-[0.1em] mb-6">
                Monthly Snapshot
              </h2>
              <div className="grid grid-cols-2 gap-8">
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Income</p>
                  <p className="font-mono text-2xl font-bold text-gray-900">{formatEuro(income)}</p>
                </div>
                <div className="bg-indigo-50/50 p-4 rounded-2xl border border-indigo-100/50">
                  <p className="text-[10px] font-bold text-indigo-400 uppercase mb-1">
                    Free Capital
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
                    Income − spent
                  </p>
                  <p className="text-[10px] text-[#9ca3af] mt-2">Spent: {formatEuro(spent)}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)] relative">
              {categories.length > 0 && <StatusDot color="#ef4444" />}
              <h2 className="text-[11px] font-bold text-[#9ca3af] uppercase tracking-[0.1em] mb-6">
                Spending by Category
              </h2>
              {categories.length === 0 ? (
                <p className="text-[14px] text-[#9ca3af]">No spending categories yet.</p>
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
                              not real spending
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
              <h2 className="text-[11px] font-bold text-[#9ca3af] uppercase tracking-[0.1em] mb-6">
                Recent Transactions
              </h2>
              {transactions.length === 0 ? (
                <p className="text-[14px] text-[#9ca3af]">No transactions found.</p>
              ) : (
                <div className="overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                        <th className="pb-4">Date</th>
                        <th className="pb-4">Merchant</th>
                        <th className="pb-4 text-right">Amount</th>
                        <th className="pb-4 pl-8">Category</th>
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
                    No insights yet. Keep using AIR4 — patterns will appear here.
                  </p>
                )}
              </div>
            </div>

            <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
              <h2 className="text-[11px] font-bold text-[#9ca3af] uppercase tracking-[0.1em] mb-2">
                Upcoming Obligations
              </h2>
              <ChatEmpty label="No obligations tracked" />
            </div>

            <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
              <h2 className="text-[11px] font-bold text-[#9ca3af] uppercase tracking-[0.1em] mb-2">
                Loans & Obligations
              </h2>
              <ChatEmpty label="No loans tracked" />
            </div>

            <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
              <h2 className="text-[11px] font-bold text-[#9ca3af] uppercase tracking-[0.1em] mb-2">
                Subscriptions
              </h2>
              <ChatEmpty label="No subscriptions tracked" />
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
        <h2 className="text-[11px] font-bold text-[#9ca3af] uppercase tracking-[0.1em] mb-6">
          Uploaded Statements
        </h2>
        {loading && uploads.length === 0 ? (
          <p className="text-[14px] text-[#9ca3af]">Loading…</p>
        ) : uploads.length === 0 ? (
          <p className="text-[14px] text-[#9ca3af]">No statements uploaded yet.</p>
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
                    <span>{up.total_transactions} transactions</span>
                    <span>Uploaded {formatUploadDate(up.created_at)}</span>
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
                  aria-label={`Delete ${up.filename}`}
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
