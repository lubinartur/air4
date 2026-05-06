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
  return `${a.toLocaleDateString("ru-RU", startOpts)} — ${b.toLocaleDateString("ru-RU", endOpts)}`;
}

function ruTxnWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "транзакция";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20))
    return "транзакции";
  return "транзакций";
}

function formatUploadLastUpdated(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const normalized = iso.includes("T") ? iso : iso.replace(" ", "T");
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return null;
  const date = d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const time = d.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${date} в ${time}`;
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
          setError(
            e instanceof Error ? e.message : "Не удалось загрузить дашборд"
          );
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
            e instanceof Error ? e.message : "Не удалось загрузить связи"
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
            e instanceof Error ? e.message : "Не удалось загрузить крупные траты"
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
        e instanceof Error ? e.message : "Не удалось загрузить инсайты"
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
        e instanceof Error ? e.message : "Не удалось сгенерировать отчёт"
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
      setReportError("Не удалось скопировать в буфер обмена");
    }
  }

  async function runAnalyzeConnections() {
    setCrossSphereError(null);
    setCrossSphereInfo(null);
    setCrossSphereAnalyzing(true);
    try {
      const res = await analyzeCrossSphere();
      if (res.created > 0) {
        setCrossSphereInfo(`Создано: ${res.created}`);
      } else if (res.cooldown_hours_remaining != null) {
        setCrossSphereInfo(
          `Пауза: ${res.cooldown_hours_remaining.toFixed(1)} ч`
        );
      } else {
        setCrossSphereInfo("Новых связей нет");
      }
      const data = await getCrossSphereInsights();
      setCrossSphere(data || []);
    } catch (e) {
      setCrossSphereError(
        e instanceof Error ? e.message : "Не удалось проанализировать связи"
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
    <div className="space-y-12">
      <header className="pt-4">
        <div className="mb-4 flex items-center gap-4">
          <div className="h-px w-8 bg-brand-accent/50" />
          <p className="mono-label !tracking-[0.3em] text-zinc-500">
            Аналитика трат / Онлайн
          </p>
        </div>
        <h1 className="text-5xl font-light tracking-tight text-zinc-100">
          Финансы
        </h1>
        <p className="mt-3 max-w-3xl text-sm font-light leading-relaxed text-zinc-500">
          Без учёта доходов и внутренних переводов.
        </p>
      </header>

      {error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      {showEmptyUploadCta ? (
        <div className="glass-card p-10 text-center border border-white/5">
          <p className="text-sm font-medium text-zinc-100">
            Нет данных — загрузи CSV Swedbank чтобы начать
          </p>
          <Link href="/upload" className="btn-primary mt-6 inline-flex">
            Загрузить выписку
          </Link>
        </div>
      ) : null}

      {!showEmptyUploadCta ? (
        <>
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
            {/* Main chart card (prototype “velocity” panel) */}
            <div className="lg:col-span-2">
              <div className="glass-card p-10 min-h-[450px] relative group">
                <div className="mb-10 flex items-center justify-between gap-6">
                  <div>
                    <div className="mono-label mb-2 text-zinc-300">
                      Динамика трат / Текущий период
                    </div>
                    <p className="text-sm text-zinc-500">
                      {periodLabel || "—"}
                      {lastUpdatedLabel ? ` • Обновлено ${lastUpdatedLabel}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Link href="/timeline" className="btn-ghost px-3 py-2 text-xs">
                      История →
                    </Link>
                    <Link href="/upload" className="btn-primary px-3 py-2 text-xs">
                      Загрузить
                    </Link>
                  </div>
                </div>

                <div className="h-[320px] w-full">
                  <SpendingChart
                    data={(summary?.by_category || []).map((x) => ({
                      category: x.category,
                      amount: x.amount,
                    }))}
                  />
                </div>
              </div>
            </div>

            {/* Side column (prototype right rail) */}
            <div className="space-y-8">
              <div className="glass-card p-8">
                <div className="mono-label mb-6 text-zinc-300">Суммарный расход</div>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-light text-zinc-100 tracking-tight tabular-nums">
                    €{summary?.total_spent?.toFixed(2) ?? "0.00"}
                  </span>
                </div>
                {txnTotal != null ? (
                  <div className="mt-4 inline-flex items-center gap-2 rounded border border-white/10 bg-white/[0.02] px-2 py-1 text-[10px] font-mono text-zinc-400">
                    {txnTotal} {ruTxnWord(txnTotal)}
                  </div>
                ) : null}
              </div>

              <div className="glass-card p-8 bg-brand-accent/[0.02] border border-brand-accent/10">
                <div className="mono-label mb-6 text-brand-accent">
                  Оптимизация (ИИ)
                </div>
                <p className="text-sm font-light text-zinc-300 leading-relaxed mb-8">
                  {insights[0]?.description
                    ? `"${insights[0].description}"`
                    : "Инсайтов пока нет. Нажми «Обновить инсайты» — это может занять несколько минут."}
                </p>
                <button
                  type="button"
                  onClick={() => void refreshInsights()}
                  disabled={insightsLoading}
                  className="btn-primary w-full disabled:opacity-60"
                >
                  {insightsLoading ? "Генерирую инсайты…" : "Обновить инсайты"}
                </button>
                <button
                  type="button"
                  onClick={() => void runGenerateReport()}
                  disabled={reportLoading}
                  className="btn-ghost mt-3 w-full disabled:opacity-60"
                >
                  {reportLoading ? "Генерирую отчёт…" : "Сгенерировать отчёт"}
                </button>
                {insightsError ? (
                  <p className="mt-3 text-xs text-red-300">{insightsError}</p>
                ) : null}
                {reportError ? (
                  <p className="mt-2 text-xs text-red-300">{reportError}</p>
                ) : null}
              </div>
            </div>
          </div>

          {/* “Anomaly Transcript” — driven by real top expenses */}
          <div className="glass-card overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/5 px-8 py-6">
              <div className="mono-label text-zinc-300">Лента крупных трат</div>
              <div className="text-[10px] font-mono text-zinc-600">
                {lastUpdatedLabel
                  ? `Обновлено ${lastUpdatedLabel}`
                  : "Обновлено —"}
              </div>
            </div>

            {topExpensesError ? (
              <div className="px-8 py-6 text-sm text-red-300">{topExpensesError}</div>
            ) : topExpensesLoading ? (
              <div className="px-8 py-6 text-sm text-zinc-500">Загрузка…</div>
            ) : topExpenses.length === 0 ? (
              <div className="px-8 py-6 text-sm text-zinc-500">
                В этом периоде нет дебетовых операций.
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {topExpenses.map((t, idx) => {
                  const severity =
                    idx === 0 ? "high" : idx === 1 ? "medium" : "low";
                  return (
                    <div
                      key={t.id}
                      className="group flex cursor-pointer items-center justify-between px-8 py-6 transition-colors hover:bg-white/[0.02]"
                    >
                      <div className="flex items-center gap-8">
                        <div className="text-[9px] font-mono text-zinc-600 tracking-widest">
                          {String(t.date || "").slice(5, 10).replace("-", " ")}
                        </div>
                        <div>
                          <div className="mb-1 text-sm font-medium text-zinc-200 transition-colors group-hover:text-brand-accent">
                            {t.description}
                          </div>
                          <div className="text-xs text-zinc-500 font-light">
                            {categoryLabel(t.category)}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-6 text-right">
                        <div className="text-sm font-mono text-zinc-300 tabular-nums">
                          -€{t.amount.toFixed(2)}
                        </div>
                        <div
                          className={`h-4 w-1 rounded-full ${
                            severity === "high"
                              ? "bg-brand-danger"
                              : severity === "medium"
                                ? "bg-brand-warning"
                                : "bg-brand-accent"
                          }`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Insights list (keeps same data/logic) */}
          {(insights || []).slice(0, 3).length > 0 ? (
            <div className="grid gap-4 lg:grid-cols-3">
              {(insights || []).slice(0, 3).map((ins, idx) => (
                <InsightCard key={`${ins.type}-${idx}`} insight={ins} />
              ))}
            </div>
          ) : !insightsLoading && insights.length === 0 && !insightsAttempted ? (
            <div className="glass-card p-6 text-sm text-zinc-400">
              Инсайтов пока нет. Нажми «Обновить инсайты».
            </div>
          ) : !insightsLoading &&
            insights.length === 0 &&
            insightsAttempted &&
            !insightsError ? (
            <div className="glass-card p-6 text-sm text-zinc-400">
              Инсайты не вернулись. Проверь, что Ollama запущен, и попробуй ещё раз
              (или посмотри логи бэкенда).
            </div>
          ) : null}

          {/* Monthly report (same logic, dark styling) */}
          {reportText ? (
            <div className="glass-card p-6">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 pb-4">
                <button
                  type="button"
                  onClick={() => setReportExpanded((e) => !e)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-semibold uppercase tracking-wider text-zinc-500 transition-colors hover:text-zinc-300"
                  aria-expanded={reportExpanded}
                >
                  <span className="tabular-nums text-zinc-600">
                    {reportExpanded ? "▼" : "▶"}
                  </span>
                  Месячный отчёт
                </button>
                <button
                  type="button"
                  onClick={() => void copyReport()}
                  className="btn-primary shrink-0 px-3 py-1.5 text-xs"
                >
                  {copyDone ? "Скопировано!" : "Копировать"}
                </button>
              </div>
              {reportExpanded ? (
                <div className="mt-5 space-y-6 text-[15px] leading-[1.75] text-zinc-200">
                  {reportText.split(/\n\n+/).map((block, idx) => (
                    <p key={idx} className="whitespace-pre-wrap">
                      {block.trim()}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Cross-sphere connections (same logic) */}
          <div className="glass-card p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="mono-label text-zinc-300">Межсферные связи</h3>
              <button
                type="button"
                onClick={() => void runAnalyzeConnections()}
                disabled={crossSphereAnalyzing}
                className="btn-primary px-3 py-1.5 text-xs disabled:opacity-60"
              >
                {crossSphereAnalyzing ? "Анализирую…" : "Анализировать связи"}
              </button>
            </div>

            {crossSphereInfo ? (
              <p className="mb-3 text-xs font-mono text-zinc-600">{crossSphereInfo}</p>
            ) : null}
            {crossSphereError ? (
              <p className="mb-3 text-xs text-red-300">{crossSphereError}</p>
            ) : null}

            {crossSphereLoading ? (
              <p className="text-sm text-zinc-500">Загрузка…</p>
            ) : crossSphere.length === 0 ? (
              <p className="text-sm text-zinc-500">
                Связей пока нет. Нажми «Анализировать связи».
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

          <TransactionTable />
        </>
      ) : null}
    </div>
  );
}
