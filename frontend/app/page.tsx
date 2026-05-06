"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  generateObservations,
  getObservations,
  getCrossSphereInsights,
  getDilemmas,
  getEvents,
  getHypotheses,
  getProjects,
  getSummary,
  type CrossSphereInsight,
  type Dilemma,
  type Hypothesis,
  type LifeEvent,
  type Observation,
  type Project,
  type Summary,
} from "@/lib/api";
import { categoryLabel } from "@/lib/categories";
import { CrossSphereCard } from "@/components/CrossSphereCard";
import { ObservationCard } from "@/components/ObservationCard";

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
  const [dilemmas, setDilemmas] = useState<Dilemma[]>([]);
  const [dilemmasError, setDilemmasError] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [hypotheses, setHypotheses] = useState<Hypothesis[]>([]);
  const [hypothesesError, setHypothesesError] = useState<string | null>(null);
  const [connections, setConnections] = useState<CrossSphereInsight[]>([]);
  const [connectionsError, setConnectionsError] = useState<string | null>(null);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [observationsError, setObservationsError] = useState<string | null>(null);
  const [obsGenerating, setObsGenerating] = useState(false);
  const [obsInfo, setObsInfo] = useState<string | null>(null);

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

      setDilemmasError(null);
      try {
        const ds = await getDilemmas();
        if (!cancelled) setDilemmas(ds || []);
      } catch (e) {
        if (!cancelled)
          setDilemmasError(
            e instanceof Error ? e.message : "Failed to load dilemmas"
          );
      }

      setProjectsError(null);
      try {
        const ps = await getProjects();
        if (!cancelled) setProjects(ps || []);
      } catch (e) {
        if (!cancelled) setProjectsError(e instanceof Error ? e.message : "Failed to load projects");
      }

      setHypothesesError(null);
      try {
        const hs = await getHypotheses();
        if (!cancelled) setHypotheses(hs || []);
      } catch (e) {
        if (!cancelled)
          setHypothesesError(
            e instanceof Error ? e.message : "Failed to load patterns"
          );
      }

      setConnectionsError(null);
      try {
        const cs = await getCrossSphereInsights();
        if (!cancelled) setConnections(cs || []);
      } catch (e) {
        if (!cancelled)
          setConnectionsError(
            e instanceof Error ? e.message : "Failed to load connections"
          );
      }

      setObservationsError(null);
      try {
        const os = await getObservations();
        if (!cancelled) setObservations(os || []);
      } catch (e) {
        if (!cancelled)
          setObservationsError(
            e instanceof Error ? e.message : "Failed to load observations"
          );
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
  const openDilemmasCount = useMemo(
    () => (dilemmas || []).filter((d) => d.status === "open").length,
    [dilemmas]
  );
  const activeProjectsCount = useMemo(
    () => (projects || []).filter((p) => p.status === "active").length,
    [projects]
  );
  const last2Projects = useMemo(() => (projects || []).slice(0, 2), [projects]);
  const pendingHypothesesCount = useMemo(
    () => (hypotheses || []).filter((h) => h.status === "pending").length,
    [hypotheses]
  );
  const hasConnections = (connections || []).length > 0;
  const unreadObservations = useMemo(
    () => (observations || []).filter((o) => !o.is_read),
    [observations]
  );

  const noFinanceData =
    summary == null ||
    summary.upload_id == null ||
    (summary.total_spent === 0 && (summary.by_category || []).length === 0);

  return (
    <div className="grid gap-6">
      <div className="rounded-2xl border border-zinc-100 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          Обзор
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          Твой личный командный центр — финансы, жизнь, проекты и здоровье.
        </p>
      </div>

      {unreadObservations.length > 0 ? (
        <section className="rounded-2xl border border-zinc-100 bg-white p-6 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
                НАБЛЮДЕНИЯ
              </h2>
              <span className="rounded bg-zinc-900 px-1.5 text-xs font-medium text-white tabular-nums">
                {unreadObservations.length}
              </span>
            </div>
            <button
              type="button"
              onClick={async () => {
                setObsGenerating(true);
                setObsInfo(null);
                setObservationsError(null);
                try {
                  const r = await generateObservations();
                  if (r.created > 0) setObsInfo(`Создано: ${r.created}`);
                  else if (r.cooldown_days_remaining != null)
                    setObsInfo(
                      `Кулдаун: ${r.cooldown_days_remaining.toFixed(1)}д`
                    );
                  else setObsInfo("Новых наблюдений нет");
                  const os = await getObservations();
                  setObservations(os || []);
                } catch (e) {
                  setObservationsError(
                    e instanceof Error ? e.message : "Не удалось сгенерировать"
                  );
                } finally {
                  setObsGenerating(false);
                }
              }}
              disabled={obsGenerating}
              className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {obsGenerating ? "Генерирую…" : "Сгенерировать наблюдения"}
            </button>
          </div>

          {obsInfo ? (
            <p className="mb-3 text-xs text-zinc-500">{obsInfo}</p>
          ) : null}
          {observationsError ? (
            <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {observationsError}
            </div>
          ) : null}

          <div className="grid gap-3">
            {unreadObservations.slice(0, 2).map((o) => (
              <ObservationCard
                key={o.id}
                observation={o}
                onRead={(u) =>
                  setObservations((prev) =>
                    prev.map((x) => (x.id === u.id ? u : x))
                  )
                }
              />
            ))}
          </div>
        </section>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Patterns */}
        {pendingHypothesesCount > 0 ? (
          <div className="rounded-2xl border border-zinc-100 bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-zinc-900">Patterns</h2>
                <p className="mt-1 text-sm text-zinc-500">
                  AIR4 хочет задать тебе {pendingHypothesesCount} вопросов
                </p>
              </div>
              <Link
                href="/hypotheses"
                className="shrink-0 text-sm font-medium text-zinc-900 hover:underline"
              >
                Открыть →
              </Link>
            </div>
            {hypothesesError ? (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {hypothesesError}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Finance */}
        <div className="rounded-2xl border border-zinc-100 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-zinc-900">Finance</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Сводка трат за последний период
              </p>
            </div>
            <Link
              href="/dashboard"
              className="shrink-0 text-sm font-medium text-zinc-900 hover:underline"
            >
              Открыть →
            </Link>
          </div>

          {summaryError ? (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {summaryError}
            </div>
          ) : noFinanceData ? (
            <div className="mt-6 rounded-xl border border-zinc-100 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
              Нет данных — загрузи выписку
              <div className="mt-3">
                <Link
                  href="/upload"
                  className="inline-flex rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
                >
                  Загрузить выписку
                </Link>
              </div>
            </div>
          ) : (
            <div className="mt-6">
              <div className="text-xs font-medium uppercase tracking-wider text-zinc-400">
                ПОТРАЧЕНО
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
                Здоровье и спорт
              </h2>
              <p className="mt-1 text-sm text-zinc-500">
                Тренировки, сон и энергия
              </p>
            </div>
            <span className="rounded bg-zinc-100 px-1.5 text-xs font-medium text-zinc-400">
              Скоро
            </span>
          </div>
        </div>

        {/* Projects */}
        <div className="rounded-2xl border border-zinc-100 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-zinc-900">Проекты</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Активные проекты и прогресс
              </p>
            </div>
            <Link
              href="/projects"
              className="shrink-0 text-sm font-medium text-zinc-900 hover:underline"
            >
              Открыть →
            </Link>
          </div>

          {projectsError ? (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {projectsError}
            </div>
          ) : projects.length === 0 ? (
            <div className="mt-6 rounded-xl border border-zinc-100 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
              Проектов пока нет.
              <div className="mt-3">
                <Link
                  href="/projects"
                  className="inline-flex rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
                >
                  Добавить проект
                </Link>
              </div>
            </div>
          ) : (
            <div className="mt-6">
              <div className="text-xs font-medium uppercase tracking-wider text-zinc-400">
                АКТИВНЫХ ПРОЕКТОВ
              </div>
              <div className="mt-2 text-3xl font-bold text-zinc-900 tabular-nums">
                {activeProjectsCount}
              </div>
              <div className="mt-4 grid gap-2">
                {last2Projects.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-zinc-900">
                      {p.name}
                    </span>
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-600">
                      {p.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Life */}
        <div className="rounded-2xl border border-zinc-100 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-zinc-900">Жизнь</h2>
              <p className="mt-1 text-sm text-zinc-500">
                События и факты которые помнит AIR4
              </p>
            </div>
            <Link
              href="/events"
              className="shrink-0 text-sm font-medium text-zinc-900 hover:underline"
            >
              Открыть →
            </Link>
          </div>

          {eventsError ? (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {eventsError}
            </div>
          ) : dilemmasError ? (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {dilemmasError}
            </div>
          ) : (
            <div className="mt-6">
              <div className="text-xs font-medium uppercase tracking-wider text-zinc-400">
                СОБЫТИЙ НА ЭТОЙ НЕДЕЛЕ
              </div>
              <div className="mt-2 text-3xl font-bold text-zinc-900 tabular-nums">
                {eventsThisWeekCount}
              </div>
              {openDilemmasCount > 0 ? (
                <div className="mt-3 text-sm text-zinc-700">
                  Открытых дилемм:{" "}
                  <Link
                    href="/dilemmas"
                    className="font-medium text-zinc-900 hover:underline"
                  >
                    {openDilemmasCount}
                  </Link>
                </div>
              ) : null}
              <div className="mt-4 grid gap-2">
                {last2Events.length === 0 ? (
                  <p className="text-sm text-zinc-600">
                    Событий пока нет. Расскажи AIR4 о своей жизни в чате.
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

      {hasConnections ? (
        <section className="rounded-2xl border border-zinc-100 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
              AIR4 нашёл связи
            </h2>
            <Link
              href="/dashboard"
              className="text-sm font-medium text-zinc-900 hover:underline"
            >
              Смотреть все →
            </Link>
          </div>
          {connectionsError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {connectionsError}
            </div>
          ) : (
            <div className="grid gap-3">
              {connections.slice(0, 2).map((ins) => (
                <CrossSphereCard key={ins.id} insight={ins} />
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
