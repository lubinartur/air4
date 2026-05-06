"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  comparePeriods,
  getTimeline,
  type CompareResponse,
  type TimelineUpload,
} from "@/lib/api";
import { categoryLabel } from "@/lib/categories";

function eur(n: number) {
  return `€${Number(n || 0).toFixed(2)}`;
}

function periodLabel(u: { period_start: string | null; period_end: string | null }) {
  if (!u.period_start || !u.period_end) return "—";
  const a = new Date(u.period_start.includes("T") ? u.period_start : `${u.period_start}T12:00:00`);
  const b = new Date(u.period_end.includes("T") ? u.period_end : `${u.period_end}T12:00:00`);
  const left = a.toLocaleDateString("en-GB", { month: "short" });
  const right = b.toLocaleDateString("en-GB", { month: "short" });
  return `${left}–${right}`;
}

function diffTone(diff: number): string {
  if (diff > 0.01) return "text-red-400";
  if (diff < -0.01) return "text-emerald-400";
  return "text-zinc-500";
}

export default function TimelinePage() {
  const [uploads, setUploads] = useState<TimelineUpload[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [compare, setCompare] = useState<CompareResponse | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await getTimeline();
        if (!cancelled) setUploads(res.uploads || []);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Failed to load timeline");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadCompare() {
      setCompare(null);
      setCompareError(null);
      if (selected.length !== 2) return;
      setCompareLoading(true);
      try {
        const [a, b] = selected;
        const res = await comparePeriods(a, b);
        if (!cancelled) setCompare(res);
      } catch (e) {
        if (!cancelled)
          setCompareError(
            e instanceof Error ? e.message : "Failed to compare periods"
          );
      } finally {
        if (!cancelled) setCompareLoading(false);
      }
    }
    void loadCompare();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const chartData = useMemo(() => {
    return (uploads || [])
      .slice()
      .reverse()
      .map((u) => ({
        id: u.upload_id,
        label: periodLabel(u),
        total: u.total_spent,
      }));
  }, [uploads]);

  function toggleSelect(id: number) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length < 2) return [...prev, id];
      return [prev[1], id];
    });
  }

  function askAboutComparison() {
    if (!compare) return;
    const p1 = compare.period1;
    const p2 = compare.period2;
    const msg = `Сравни эти два периода:\n\nПериод 1 (${p1.period_start ?? "—"} — ${p1.period_end ?? "—"}): ${eur(p1.total_spent)}\nПериод 2 (${p2.period_start ?? "—"} — ${p2.period_end ?? "—"}): ${eur(p2.total_spent)}\n\nЧто изменилось сильнее всего и что мне делать дальше?`;
    window.dispatchEvent(new CustomEvent("air4-chat-prefill", { detail: { message: msg } }));
  }

  return (
    <div className="space-y-8">
      <header className="glass-card p-8">
        <div className="mono-label mb-2 text-zinc-500">Temporal spend</div>
        <h1 className="text-4xl font-light tracking-tight text-zinc-100">
          История
        </h1>
        <p className="mt-3 text-sm font-light text-zinc-500">
          Твои траты по всем периодам
        </p>
      </header>

      {error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="text-sm text-zinc-500">Загружаю…</div>
      ) : uploads.length === 0 ? (
        <div className="glass-card border border-dashed border-white/10 p-10 text-center text-sm text-zinc-500">
          Пока нет периодов. Загрузи CSV Swedbank чтобы начать.
        </div>
      ) : (
        <>
          <section className="glass-card p-8">
            <h2 className="mono-label mb-6 text-zinc-300">Периоды</h2>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {uploads.map((u) => {
                const active = selected.includes(u.upload_id);
                const top2 = (u.by_category || []).slice(0, 2);
                return (
                  <button
                    key={u.upload_id}
                    type="button"
                    onClick={() => toggleSelect(u.upload_id)}
                    className={`min-w-[260px] rounded-2xl border p-4 text-left transition-colors ${
                      active
                        ? "border-brand-accent/40 bg-brand-accent/10 text-zinc-100 shadow-[0_0_24px_-8px_rgba(59,130,246,0.35)]"
                        : "border-white/10 bg-white/[0.02] text-zinc-100 hover:border-white/20"
                    }`}
                  >
                    <div
                      className={`text-xs font-mono uppercase tracking-wider ${
                        active ? "text-brand-accent/90" : "text-zinc-500"
                      }`}
                    >
                      {u.period_start ?? "—"} — {u.period_end ?? "—"}
                    </div>
                    <div
                      className={`mt-2 text-2xl font-light tabular-nums ${
                        active ? "text-zinc-100" : "text-zinc-100"
                      }`}
                    >
                      {eur(u.total_spent)}
                    </div>
                    <div
                      className={`mt-2 text-sm ${
                        active ? "text-zinc-400" : "text-zinc-500"
                      }`}
                    >
                      {top2.length === 0
                        ? "Пока нет категорий"
                        : top2
                            .map((c) => `${categoryLabel(c.category)} ${eur(c.amount)}`)
                            .join(" · ")}
                    </div>
                    <div
                      className={`mt-2 text-xs font-mono ${
                        active ? "text-zinc-500" : "text-zinc-600"
                      }`}
                    >
                      {u.transaction_count} транзакций
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-zinc-600">
              Выбери два периода для сравнения.
            </p>
          </section>

          <section className="glass-card p-8">
            <h2 className="mono-label mb-6 text-zinc-300">Сравнение</h2>

            {selected.length !== 2 ? (
              <div className="text-sm text-zinc-500">
                Выбери два периода выше.
              </div>
            ) : compareLoading ? (
              <div className="text-sm text-zinc-500">Сравниваю…</div>
            ) : compareError ? (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {compareError}
              </div>
            ) : compare ? (
              <div className="grid gap-6">
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="glass-card p-5">
                    <div className="mono-label text-zinc-500">Период 1</div>
                    <div className="mt-1 text-sm text-zinc-500">
                      {compare.period1.period_start ?? "—"} —{" "}
                      {compare.period1.period_end ?? "—"}
                    </div>
                    <div className="mt-2 text-2xl font-light tabular-nums text-zinc-100">
                      {eur(compare.period1.total_spent)}
                    </div>
                  </div>
                  <div className="glass-card p-5">
                    <div className="mono-label text-zinc-500">Период 2</div>
                    <div className="mt-1 text-sm text-zinc-500">
                      {compare.period2.period_start ?? "—"} —{" "}
                      {compare.period2.period_end ?? "—"}
                    </div>
                    <div className="mt-2 text-2xl font-light tabular-nums text-zinc-100">
                      {eur(compare.period2.total_spent)}
                    </div>
                  </div>
                  <div className="glass-card p-5">
                    <div className="mono-label text-zinc-500">Изменение</div>
                    <div className="mt-1 text-sm text-zinc-400">
                      {compare.diff.total > 0 ? "▲" : compare.diff.total < 0 ? "▼" : "→"}{" "}
                      <span className={diffTone(compare.diff.total)}>
                        {eur(compare.diff.total)}
                      </span>{" "}
                      <span className="text-zinc-600">
                        ({compare.diff.total_pct.toFixed(1)}%)
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={askAboutComparison}
                      className="btn-primary mt-3 w-full"
                    >
                      Спросить AIR4
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-xl border border-white/5">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="border-b border-white/10 bg-zinc-950/50 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      <tr>
                        <th className="px-4 py-3">Категория</th>
                        <th className="px-4 py-3">Период 1</th>
                        <th className="px-4 py-3">Период 2</th>
                        <th className="px-4 py-3">Разница</th>
                      </tr>
                    </thead>
                    <tbody>
                      {compare.diff.by_category.map((r) => (
                        <tr key={r.category} className="border-t border-white/5">
                          <td className="px-4 py-3 font-medium text-zinc-200">
                            {categoryLabel(r.category)}
                          </td>
                          <td className="px-4 py-3 tabular-nums text-zinc-400">
                            {eur(r.period1_amount)}
                          </td>
                          <td className="px-4 py-3 tabular-nums text-zinc-400">
                            {eur(r.period2_amount)}
                          </td>
                          <td className={`px-4 py-3 tabular-nums ${diffTone(r.diff)}`}>
                            {r.diff > 0 ? "+" : ""}
                            {eur(r.diff)}{" "}
                            <span className="text-xs text-zinc-600">
                              ({r.diff_pct.toFixed(1)}%)
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </section>

          <section className="glass-card p-8">
            <h2 className="mono-label mb-6 text-zinc-300">Тренд</h2>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ left: 8, right: 8 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "#a1a1aa", fontSize: 12 }} />
                  <YAxis
                    tick={{ fill: "#a1a1aa", fontSize: 12 }}
                    tickFormatter={(v) => `€${Number(v).toFixed(0)}`}
                  />
                  <Tooltip
                    formatter={(value) => `€${Number(value ?? 0).toFixed(2)}`}
                    contentStyle={{
                      backgroundColor: "#18181b",
                      color: "#e4e4e7",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 8,
                    }}
                    labelStyle={{ color: "#a1a1aa", fontWeight: 600 }}
                  />
                  <Bar dataKey="total" fill="#3b82f6" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

