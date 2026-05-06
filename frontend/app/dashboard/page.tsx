"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  analyzeCrossSphere,
  generateReport,
  getCrossSphereInsights,
  getInsights,
  getSummary,
  getTransactions,
  type CrossSphereInsight,
  type Insight,
  type Summary,
  type Transaction,
} from "@/lib/api";
import { categoryLabel } from "@/lib/categories";
import { SpendingChart } from "@/components/SpendingChart";
import { InsightCard } from "@/components/InsightCard";
import { TransactionTable } from "@/components/TransactionTable";
import { CrossSphereCard } from "@/components/CrossSphereCard";

function formatSpendingPeriod(
  start: string | null,
  end: string | null
): string | null {
  if (!start || !end) return null;
  const a = new Date(start.includes("T") ? start : `${start}T12:00:00`);
  const b = new Date(end.includes("T") ? end : `${end}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const y1 = a.getFullYear();
  const y2 = b.getFullYear();
  const startOpts: Intl.DateTimeFormatOptions =
    y1 === y2
      ? { day: "numeric", month: "short" }
      : { day: "numeric", month: "short", year: "numeric" };
  const endOpts: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    year: "numeric",
  };
  return `${a.toLocaleDateString("en-GB", startOpts)} — ${b.toLocaleDateString("en-GB", endOpts)}`;
}

function formatUploadLastUpdated(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const normalized = iso.includes("T") ? iso : iso.replace(" ", "T");
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.getDate();
  const month = d.toLocaleDateString("en-GB", { month: "long" });
  const year = d.getFullYear();
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${day} ${month} ${year} at ${time}`;
}

async function fetchAllDebitTransactions(uploadId: number | undefined) {
  const out: Transaction[] = [];
  const limit = 200;
  let skip = 0;
  let total = Infinity;
  while (skip < total) {
    const page = await getTransactions({
      skip,
      limit,
      is_debit: true,
      exclude_internal: true,
      upload_id: uploadId,
    });
    total = page.total;
    out.push(...page.items);
    if (page.items.length === 0 || page.items.length < limit) break;
    skip += page.items.length;
  }
  return out;
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [insightsAttempted, setInsightsAttempted] = useState(false);
  const [topExpenses, setTopExpenses] = useState<Transaction[]>([]);
  const [topExpensesLoading, setTopExpensesLoading] = useState(false);
  const [topExpensesError, setTopExpensesError] = useState<string | null>(null);
  const [txnTotal, setTxnTotal] = useState<number | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportText, setReportText] = useState<string | null>(null);
  const [reportExpanded, setReportExpanded] = useState(true);
  const [copyDone, setCopyDone] = useState(false);
  const [crossSphere, setCrossSphere] = useState<CrossSphereInsight[]>([]);
  const [crossSphereLoading, setCrossSphereLoading] = useState(false);
  const [crossSphereError, setCrossSphereError] = useState<string | null>(null);
  const [crossSphereAnalyzing, setCrossSphereAnalyzing] = useState(false);
  const [crossSphereInfo, setCrossSphereInfo] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setError(null);
      try {
        const s = await getSummary();
        if (!cancelled) setSummary(s);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Failed to load dashboard");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadCrossSphere() {
      setCrossSphereError(null);
      setCrossSphereLoading(true);
      try {
        const data = await getCrossSphereInsights();
        if (!cancelled) setCrossSphere(data || []);
      } catch (e) {
        if (!cancelled)
          setCrossSphereError(
            e instanceof Error ? e.message : "Failed to load connections"
          );
      } finally {
        if (!cancelled) setCrossSphereLoading(false);
      }
    }
    void loadCrossSphere();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadTxnCount() {
      if (summary?.upload_id == null) {
        setTxnTotal(null);
        return;
      }
      try {
        const p = await getTransactions({
          upload_id: summary.upload_id,
          skip: 0,
          limit: 1,
        });
        if (!cancelled) setTxnTotal(p.total);
      } catch {
        if (!cancelled) setTxnTotal(null);
      }
    }
    void loadTxnCount();
    return () => {
      cancelled = true;
    };
  }, [summary]);

  useEffect(() => {
    if (summary === null) return;
    const uploadIdForQuery =
      summary.upload_id === null ? undefined : summary.upload_id;
    let cancelled = false;
    async function loadTop() {
      setTopExpensesLoading(true);
      setTopExpensesError(null);
      try {
        const all = await fetchAllDebitTransactions(uploadIdForQuery);
        if (cancelled) return;
        const ranked = all
          .filter((t) => t.is_debit && !t.is_internal_transfer)
          .sort((x, y) => y.amount - x.amount)
          .slice(0, 5);
        setTopExpenses(ranked);
      } catch (e) {
        if (!cancelled)
          setTopExpensesError(
            e instanceof Error ? e.message : "Failed to load top expenses"
          );
      } finally {
        if (!cancelled) setTopExpensesLoading(false);
      }
    }
    void loadTop();
    return () => {
      cancelled = true;
    };
  }, [summary]);

  async function refreshInsights() {
    setInsightsError(null);
    setInsightsLoading(true);
    try {
      const id = summary?.upload_id ?? undefined;
      const data = await getInsights(id);
      setInsights(data);
    } catch (e) {
      setInsightsError(
        e instanceof Error ? e.message : "Failed to load insights"
      );
    } finally {
      setInsightsLoading(false);
      setInsightsAttempted(true);
    }
  }

  async function runGenerateReport() {
    setReportError(null);
    setCopyDone(false);
    setReportLoading(true);
    try {
      const res = await generateReport();
      setReportText(res.report);
      setReportExpanded(true);
    } catch (e) {
      setReportError(
        e instanceof Error ? e.message : "Failed to generate report"
      );
    } finally {
      setReportLoading(false);
    }
  }

  async function copyReport() {
    if (!reportText) return;
    try {
      await navigator.clipboard.writeText(reportText);
      setCopyDone(true);
      window.setTimeout(() => setCopyDone(false), 2000);
    } catch {
      setReportError("Could not copy to clipboard");
    }
  }

  async function runAnalyzeConnections() {
    setCrossSphereError(null);
    setCrossSphereInfo(null);
    setCrossSphereAnalyzing(true);
    try {
      const res = await analyzeCrossSphere();
      if (res.created > 0) {
        setCrossSphereInfo(`Created: ${res.created}`);
      } else if (res.cooldown_hours_remaining != null) {
        setCrossSphereInfo(
          `Cooldown: ${res.cooldown_hours_remaining.toFixed(1)}h`
        );
      } else {
        setCrossSphereInfo("No new connections");
      }
      const data = await getCrossSphereInsights();
      setCrossSphere(data || []);
    } catch (e) {
      setCrossSphereError(
        e instanceof Error ? e.message : "Failed to analyze connections"
      );
    } finally {
      setCrossSphereAnalyzing(false);
    }
  }

  const periodLabel = summary
    ? formatSpendingPeriod(summary.period_start, summary.period_end)
    : null;

  const lastUpdatedLabel = formatUploadLastUpdated(summary?.created_at);

  const showEmptyUploadCta =
    summary !== null &&
    (summary.upload_id === null ||
      (txnTotal !== null &&
        summary.total_spent === 0 &&
        txnTotal === 0));

  return (
    <div className="grid gap-6">
      <div className="rounded-2xl border border-zinc-100 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          Dashboard
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          Summary excludes income and internal transfers.
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {showEmptyUploadCta ? (
        <div className="rounded-2xl border border-zinc-100 bg-white p-8 text-center shadow-sm">
          <p className="text-sm font-medium text-zinc-900">
            No data yet — Upload your Swedbank CSV to get started
          </p>
          <Link
            href="/upload"
            className="mt-4 inline-flex rounded-xl bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white"
          >
            Upload statements
          </Link>
        </div>
      ) : null}

      {!showEmptyUploadCta ? (
        <>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="rounded-2xl border border-zinc-100 bg-white p-6 shadow-sm">
            <div className="text-xs font-medium uppercase tracking-wider text-zinc-400">
              Total spent
            </div>
            <div className="mt-2 text-4xl font-bold text-zinc-900">
              €{summary?.total_spent?.toFixed(2) ?? "0.00"}
            </div>
            {periodLabel ? (
              <p className="mt-2 text-sm text-zinc-400">{periodLabel}</p>
            ) : null}
            {lastUpdatedLabel ? (
              <p className="mt-2 text-xs text-zinc-400">
                Last updated: {lastUpdatedLabel}
              </p>
            ) : null}
          </div>
          <div className="mt-6">
            <SpendingChart
              data={(summary?.by_category || []).map((x) => ({
                category: x.category,
                amount: x.amount,
              }))}
            />
          </div>
        </div>

        <div className="grid gap-4">
          <div className="flex flex-col gap-2 rounded-2xl border border-zinc-100 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => void refreshInsights()}
                disabled={insightsLoading}
                className="w-full rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
              >
                {insightsLoading ? "Generating insights…" : "Refresh insights"}
              </button>
              <button
                type="button"
                onClick={() => void runGenerateReport()}
                disabled={reportLoading}
                className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-900 disabled:opacity-60"
              >
                {reportLoading
                  ? "Generating your monthly report..."
                  : "Generate report"}
              </button>
            </div>
            <p className="text-xs text-zinc-500">
              AI insights are not loaded automatically. This can take up to a few
              minutes. Monthly reports blend spending, events, facts, and profile
              into a personal life overview.
            </p>
            {insightsError ? (
              <p className="text-xs text-red-700">{insightsError}</p>
            ) : null}
            {reportError ? (
              <p className="text-xs text-red-700">{reportError}</p>
            ) : null}
          </div>
          {reportText ? (
            <div className="rounded-2xl border border-zinc-100 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 pb-4">
                <button
                  type="button"
                  onClick={() => setReportExpanded((e) => !e)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-semibold uppercase tracking-wider text-zinc-400 transition-colors hover:text-zinc-600"
                  aria-expanded={reportExpanded}
                >
                  <span className="tabular-nums text-zinc-500">
                    {reportExpanded ? "▼" : "▶"}
                  </span>
                  Monthly life report
                </button>
                <button
                  type="button"
                  onClick={() => void copyReport()}
                  className="shrink-0 rounded-xl bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white"
                >
                  {copyDone ? "Copied" : "Copy"}
                </button>
              </div>
              {reportExpanded ? (
                <div className="mt-5 space-y-6 text-[15px] leading-[1.75] text-zinc-800">
                  {reportText.split(/\n\n+/).map((block, idx) => (
                    <p key={idx} className="whitespace-pre-wrap">
                      {block.trim()}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {(insights || []).slice(0, 3).map((ins, idx) => (
            <InsightCard key={`${ins.type}-${idx}`} insight={ins} />
          ))}
          {!insightsLoading && insights.length === 0 && !insightsAttempted ? (
            <div className="rounded-2xl border border-zinc-100 bg-white p-5 text-sm text-zinc-700 shadow-sm">
              No insights yet. Click &quot;Refresh insights&quot; when you want
              them.
            </div>
          ) : null}
          {!insightsLoading &&
          insights.length === 0 &&
          insightsAttempted &&
          !insightsError ? (
            <div className="rounded-2xl border border-zinc-100 bg-white p-5 text-sm text-zinc-700 shadow-sm">
              No insights were returned. Check that Ollama is running and try
              again, or see backend logs.
            </div>
          ) : null}

          <div className="rounded-2xl border border-zinc-100 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
                Cross-sphere connections
              </h3>
              <button
                type="button"
                onClick={() => void runAnalyzeConnections()}
                disabled={crossSphereAnalyzing}
                className="rounded-xl bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
              >
                {crossSphereAnalyzing ? "Analyzing…" : "Analyze connections"}
              </button>
            </div>

            {crossSphereInfo ? (
              <p className="mb-3 text-xs text-zinc-500">{crossSphereInfo}</p>
            ) : null}
            {crossSphereError ? (
              <p className="mb-3 text-xs text-red-700">{crossSphereError}</p>
            ) : null}

            {crossSphereLoading ? (
              <p className="text-sm text-zinc-600">Loading…</p>
            ) : crossSphere.length === 0 ? (
              <p className="text-sm text-zinc-600">
                No connections yet. Click “Analyze connections”.
              </p>
            ) : (
              <div className="grid gap-3">
                {crossSphere.slice(0, 3).map((ins) => (
                  <CrossSphereCard
                    key={ins.id}
                    insight={ins}
                    onDeleted={(id) =>
                      setCrossSphere((prev) => prev.filter((x) => x.id !== id))
                    }
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-100 bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Top expenses
        </h3>
        {topExpensesError ? (
          <p className="mt-3 text-sm text-red-700">{topExpensesError}</p>
        ) : topExpensesLoading ? (
          <p className="mt-3 text-sm text-zinc-500">Loading…</p>
        ) : topExpenses.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">
            No debit transactions in this period.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-zinc-100">
            {topExpenses.map((t) => (
              <li
                key={t.id}
                className="flex items-start justify-between gap-4 py-3 first:pt-0"
              >
                <div className="min-w-0">
                  <div className="font-medium text-zinc-900">{t.description}</div>
                  <div className="mt-0.5 text-sm text-zinc-500">
                    {categoryLabel(t.category)}
                  </div>
                </div>
                <div className="shrink-0 font-semibold tabular-nums text-zinc-900">
                  €{t.amount.toFixed(2)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <TransactionTable />
        </>
      ) : null}
    </div>
  );
}
