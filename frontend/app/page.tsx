"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getEvents, getSummary, type LifeEvent, type Summary } from "@/lib/api";
import { categoryLabel } from "@/lib/categories";

function eur(n: number) {
  return `€${Number(n || 0).toFixed(2)}`;
}

function formatSpendingPeriod(
  start: string | null,
  end: string | null
): string | null {
  if (!start || !end) return null;
  const a = new Date(start.includes("T") ? start : `${start}T12:00:00`);
  const b = new Date(end.includes("T") ? end : `${end}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const startOpts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  const endOpts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };
  return `${a.toLocaleDateString("en-GB", startOpts)} — ${b.toLocaleDateString("en-GB", endOpts)}`;
}

function isWithinLastDays(isoDate: string | null | undefined, days: number): boolean {
  if (!isoDate) return false;
  const d = new Date(isoDate.includes("T") ? isoDate : `${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  const now = Date.now();
  return now - d.getTime() <= days * 24 * 60 * 60 * 1000;
}

export default function OverviewPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [events, setEvents] = useState<LifeEvent[]>([]);
  const [eventsError, setEventsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setSummaryError(null);
      try {
        const s = await getSummary();
        if (!cancelled) setSummary(s);
      } catch (e) {
        if (!cancelled) setSummaryError(e instanceof Error ? e.message : "Failed to load finance summary");
      }

      setEventsError(null);
      try {
        const ev = await getEvents();
        if (!cancelled) setEvents(ev || []);
      } catch (e) {
        if (!cancelled) setEventsError(e instanceof Error ? e.message : "Failed to load life events");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const financePeriod = useMemo(() => {
    return summary ? formatSpendingPeriod(summary.period_start, summary.period_end) : null;
  }, [summary]);

  const financeTop2 = useMemo(() => {
    return (summary?.by_category || []).slice(0, 2);
  }, [summary]);

  const eventsThisWeekCount = useMemo(() => {
    return (events || []).filter((e) => isWithinLastDays(e.date, 7)).length;
  }, [events]);

  const last2Events = useMemo(() => (events || []).slice(0, 2), [events]);

  const noFinanceData =
    summary == null ||
    summary.upload_id == null ||
    (summary.total_spent === 0 && (summary.by_category || []).length === 0);

  return (
    <div className="grid gap-6">
      <div className="rounded-2xl border border-zinc-100 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          Overview
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          Your personal command center — finance, life, projects, and health.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Finance */}
        <div className="rounded-2xl border border-zinc-100 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-zinc-900">Finance</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Spending summary for the latest period
              </p>
            </div>
            <Link
              href="/dashboard"
              className="shrink-0 text-sm font-medium text-zinc-900 hover:underline"
            >
              View Finance →
            </Link>
          </div>

          {summaryError ? (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {summaryError}
            </div>
          ) : noFinanceData ? (
            <div className="mt-6 rounded-xl border border-zinc-100 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
              No data yet — Upload your statements
              <div className="mt-3">
                <Link
                  href="/upload"
                  className="inline-flex rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
                >
                  Upload statements
                </Link>
              </div>
            </div>
          ) : (
            <div className="mt-6">
              <div className="text-xs font-medium uppercase tracking-wider text-zinc-400">
                Total spent
              </div>
              <div className="mt-2 text-4xl font-bold text-zinc-900 tabular-nums">
                {eur(summary?.total_spent ?? 0)}
              </div>
              {financePeriod ? (
                <p className="mt-2 text-sm text-zinc-400">{financePeriod}</p>
              ) : null}
              {financeTop2.length ? (
                <div className="mt-4 grid gap-2">
                  {financeTop2.map((c) => (
                    <div
                      key={c.category}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="text-zinc-600">
                        {categoryLabel(c.category)}
                      </span>
                      <span className="font-medium tabular-nums text-zinc-900">
                        {eur(c.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* Health (soon) */}
        <div className="rounded-2xl border border-zinc-100 bg-white p-6 shadow-sm opacity-60">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-zinc-900">
                Health &amp; Sport
              </h2>
              <p className="mt-1 text-sm text-zinc-500">
                Track workouts, sleep, and energy
              </p>
            </div>
            <span className="rounded bg-zinc-100 px-1.5 text-xs font-medium text-zinc-400">
              Coming soon
            </span>
          </div>
        </div>

        {/* Projects (soon) */}
        <div className="rounded-2xl border border-zinc-100 bg-white p-6 shadow-sm opacity-60">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-zinc-900">Projects</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Track your projects and focus
              </p>
            </div>
            <span className="rounded bg-zinc-100 px-1.5 text-xs font-medium text-zinc-400">
              Coming soon
            </span>
          </div>
        </div>

        {/* Life */}
        <div className="rounded-2xl border border-zinc-100 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-zinc-900">Life</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Events and facts AIR4 remembers
              </p>
            </div>
            <Link
              href="/events"
              className="shrink-0 text-sm font-medium text-zinc-900 hover:underline"
            >
              View Life →
            </Link>
          </div>

          {eventsError ? (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {eventsError}
            </div>
          ) : (
            <div className="mt-6">
              <div className="text-xs font-medium uppercase tracking-wider text-zinc-400">
                Events this week
              </div>
              <div className="mt-2 text-3xl font-bold text-zinc-900 tabular-nums">
                {eventsThisWeekCount}
              </div>
              <div className="mt-4 grid gap-2">
                {last2Events.length === 0 ? (
                  <p className="text-sm text-zinc-600">
                    No events yet. Tell AIR4 about your life in chat.
                  </p>
                ) : (
                  last2Events.map((e) => (
                    <div key={e.id} className="text-sm text-zinc-700">
                      <span className="font-medium text-zinc-900">
                        {e.title}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
