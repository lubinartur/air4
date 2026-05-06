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
  if (diff > 0.01) return "text-red-700";
  if (diff < -0.01) return "text-emerald-700";
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
    <div className="grid gap-6">
      <div className="rounded-2xl border border-zinc-100 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          История
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          Твои траты по всем периодам
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="text-sm text-zinc-600">Загружаю…</div>
      ) : uploads.length === 0 ? (
        <div className="rounded-2xl border border-zinc-100 bg-white p-8 text-center text-sm text-zinc-700 shadow-sm">
          Пока нет периодов. Загрузи CSV Swedbank чтобы начать.
        </div>
      ) : (
        <>
          <section className="rounded-2xl border border-zinc-100 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-400">
              ПЕРИОДЫ
            </h2>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {uploads.map((u) => {
                const active = selected.includes(u.upload_id);
                const top2 = (u.by_category || []).slice(0, 2);
                return (
                  <button
                    key={u.upload_id}
                    type="button"
                    onClick={() => toggleSelect(u.upload_id)}
                    className={`min-w-[260px] rounded-2xl border p-4 text-left shadow-sm transition-colors ${
                      active
                        ? "border-zinc-900 bg-zinc-900 text-white"
                        : "border-zinc-100 bg-white hover:border-zinc-300"
                    }`}
                  >
                    <div
                      className={`text-xs font-medium uppercase tracking-wider ${
                        active ? "text-zinc-200" : "text-zinc-400"
                      }`}
                    >
                      {u.period_start ?? "—"} — {u.period_end ?? "—"}
                    </div>
                    <div
                      className={`mt-2 text-2xl font-bold tabular-nums ${
                        active ? "text-white" : "text-zinc-900"
                      }`}
                    >
                      {eur(u.total_spent)}
                    </div>
                    <div
                      className={`mt-2 text-sm ${
                        active ? "text-zinc-200" : "text-zinc-500"
                      }`}
                    >
                      {top2.length === 0
                        ? "Пока нет категорий"
                        : top2
                            .map((c) => `${categoryLabel(c.category)} ${eur(c.amount)}`)
                            .join(" · ")}
                    </div>
                    <div
                      className={`mt-2 text-xs ${
                        active ? "text-zinc-200" : "text-zinc-400"
                      }`}
                    >
                      {u.transaction_count} транзакций
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-zinc-500">
              Выбери два периода для сравнения.
            </p>
          </section>

          <section className="rounded-2xl border border-zinc-100 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-400">
              СРАВНЕНИЕ
            </h2>

            {selected.length !== 2 ? (
              <div className="text-sm text-zinc-600">
                Выбери два периода выше.
              </div>
            ) : compareLoading ? (
              <div className="text-sm text-zinc-600">Сравниваю…</div>
            ) : compareError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {compareError}
              </div>
            ) : compare ? (
              <div className="grid gap-6">
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="rounded-2xl border border-zinc-100 bg-white p-4 shadow-sm">
                    <div className="text-xs font-medium uppercase tracking-wider text-zinc-400">
                      ПЕРИОД 1
                    </div>
                    <div className="mt-1 text-sm text-zinc-600">
                      {compare.period1.period_start ?? "—"} —{" "}
                      {compare.period1.period_end ?? "—"}
                    </div>
                    <div className="mt-2 text-2xl font-bold tabular-nums text-zinc-900">
                      {eur(compare.period1.total_spent)}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-zinc-100 bg-white p-4 shadow-sm">
                    <div className="text-xs font-medium uppercase tracking-wider text-zinc-400">
                      ПЕРИОД 2
                    </div>
                    <div className="mt-1 text-sm text-zinc-600">
                      {compare.period2.period_start ?? "—"} —{" "}
                      {compare.period2.period_end ?? "—"}
                    </div>
                    <div className="mt-2 text-2xl font-bold tabular-nums text-zinc-900">
                      {eur(compare.period2.total_spent)}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-zinc-100 bg-white p-4 shadow-sm">
                    <div className="text-xs font-medium uppercase tracking-wider text-zinc-400">
                      ИЗМЕНЕНИЕ
                    </div>
                    <div className="mt-1 text-sm text-zinc-600">
                      {compare.diff.total > 0 ? "▲" : compare.diff.total < 0 ? "▼" : "→"}{" "}
                      <span className={diffTone(compare.diff.total)}>
                        {eur(compare.diff.total)}
                      </span>{" "}
                      <span className="text-zinc-500">
                        ({compare.diff.total_pct.toFixed(1)}%)
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={askAboutComparison}
                      className="mt-3 w-full rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white"
                    >
                      Спросить AIR4
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="border-y border-zinc-100 bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-700">
                      <tr>
                        <th className="px-4 py-3">КАТЕГОРИЯ</th>
                        <th className="px-4 py-3">ПЕРИОД 1</th>
                        <th className="px-4 py-3">ПЕРИОД 2</th>
                        <th className="px-4 py-3">РАЗНИЦА</th>
                      </tr>
                    </thead>
                    <tbody>
                      {compare.diff.by_category.map((r) => (
                        <tr key={r.category} className="border-t border-zinc-100">
                          <td className="px-4 py-3 font-medium text-zinc-900">
                            {categoryLabel(r.category)}
                          </td>
                          <td className="px-4 py-3 tabular-nums text-zinc-700">
                            {eur(r.period1_amount)}
                          </td>
                          <td className="px-4 py-3 tabular-nums text-zinc-700">
                            {eur(r.period2_amount)}
                          </td>
                          <td className={`px-4 py-3 tabular-nums ${diffTone(r.diff)}`}>
                            {r.diff > 0 ? "+" : ""}
                            {eur(r.diff)}{" "}
                            <span className="text-xs text-zinc-500">
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

          <section className="rounded-2xl border border-zinc-100 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-400">
              ТРЕНД
            </h2>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ left: 8, right: 8 }}>
                  <CartesianGrid stroke="#f4f4f5" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "#71717a", fontSize: 12 }} />
                  <YAxis
                    tick={{ fill: "#71717a", fontSize: 12 }}
                    tickFormatter={(v) => `€${Number(v).toFixed(0)}`}
                  />
                  <Tooltip
                    formatter={(value) => `€${Number(value ?? 0).toFixed(2)}`}
                    contentStyle={{
                      color: "#18181b",
                      border: "1px solid #e4e4e7",
                      borderRadius: 8,
                    }}
                    labelStyle={{ color: "#3f3f46", fontWeight: 600 }}
                  />
                  <Bar dataKey="total" fill="#18181b" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

