"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  generateObservations,
  getObservations,
  getCrossSphereInsights,
  getDilemmas,
  getPendingFollowups,
  getInterviewAnswers,
  getEvents,
  getHypotheses,
  getProjects,
  getSummary,
  type CrossSphereInsight,
  type Dilemma,
  type InterviewAnswer,
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
  const sameYear = a.getFullYear() === b.getFullYear();
  const left = a.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  const right = b.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    ...(sameYear ? {} : { year: "numeric" as const }),
  });
  return `${left} — ${right}`;
}

function ruSphereTag(s: string): string {
  const key = s.toLowerCase();
  const map: Record<string, string> = {
    finance: "Финансы",
    life: "Жизнь",
    projects: "Проекты",
    work: "Работа",
    health: "Здоровье",
    travel: "Путешествия",
    other: "Другое",
  };
  return map[key] ?? s;
}

function observationTypeRu(t: string): string {
  const map: Record<string, string> = {
    anomaly: "аномалия",
    reminder: "напоминание",
    milestone: "веха",
    pattern: "паттерн",
  };
  return map[t] ?? t;
}

function isWithinLastDays(isoDate: string | null | undefined, days: number): boolean {
  if (!isoDate) return false;
  const d = new Date(isoDate.includes("T") ? isoDate : `${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  const now = Date.now();
  return now - d.getTime() <= days * 24 * 60 * 60 * 1000;
}

type SignalSeverity = "high" | "medium" | "low";

type CriticalSignalRow = {
  key: string;
  title: string;
  description: string;
  severity: SignalSeverity;
  sphere: string;
  href?: string;
  rightMeta?: string;
};

function observationSeverity(o: Observation): SignalSeverity {
  switch (o.observation_type) {
    case "anomaly":
      return "high";
    case "reminder":
    case "milestone":
      return "medium";
    case "pattern":
    default:
      return "low";
  }
}

function IconWallet({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
    </svg>
  );
}

function IconBriefcase({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <rect x="3" y="7" width="18" height="14" rx="2" />
      <path d="M3 13h18" />
    </svg>
  );
}

function IconHeartPulse({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M2 9h3l2 7 4-14 3 11h3" />
    </svg>
  );
}

function IconActivity({ className }: { className?: string }) {
  return (
    <svg className={className} width="120" height="120" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}

function IconAlertCircle({ className, strokeWidth = 1.5 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4M12 16h.01" />
    </svg>
  );
}

function OverviewSphereCard({
  title,
  icon,
  value,
  trend,
  detail,
}: {
  title: string;
  icon: ReactNode;
  value: string;
  trend: "up" | "down";
  detail: string;
}) {
  return (
    <div className="glass-card p-8 group hover:border-white/10 transition-all duration-700 relative">
      <div className="absolute top-0 left-0 h-px w-full bg-gradient-to-r from-transparent via-white/5 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
      <div className="mono-label mb-6 flex items-center gap-3 opacity-40 transition-opacity group-hover:opacity-100">
        <span className="rounded-md border border-white/5 bg-white/[0.03] p-1.5">{icon}</span>
        {title}
      </div>
      <div className="mb-4 flex items-baseline gap-4">
        <span className="text-4xl font-light tracking-tight text-zinc-100">{value}</span>
        <span
          className={`rounded border px-1.5 py-0.5 text-[10px] font-mono ${
            trend === "up"
              ? "border-brand-success/20 bg-brand-success/5 text-brand-success"
              : "border-brand-danger/20 bg-brand-danger/5 text-brand-danger"
          }`}
        >
          {trend === "up" ? "▲" : "▼"} {detail}
        </span>
      </div>
      <div className="relative mt-6 h-0.5 w-full overflow-hidden bg-white/[0.02]">
        <div
          className={`relative z-10 h-full ${trend === "up" ? "bg-brand-accent" : "bg-brand-danger"}`}
          style={{ width: trend === "up" ? "72%" : "44%" }}
        />
        <div className="absolute inset-0 bg-white/[0.01]" />
      </div>
    </div>
  );
}

export default function OverviewPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [events, setEvents] = useState<LifeEvent[]>([]);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [dilemmas, setDilemmas] = useState<Dilemma[]>([]);
  const [dilemmasError, setDilemmasError] = useState<string | null>(null);
  const [pendingFollowupsCount, setPendingFollowupsCount] = useState<number>(0);
  const [followupsError, setFollowupsError] = useState<string | null>(null);
  const [interviewAnswers, setInterviewAnswers] = useState<InterviewAnswer[]>([]);
  const [interviewError, setInterviewError] = useState<string | null>(null);
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
        if (!cancelled)
          setSummaryError(
            e instanceof Error ? e.message : "Не удалось загрузить сводку по финансам"
          );
      }

      setEventsError(null);
      try {
        const ev = await getEvents();
        if (!cancelled) setEvents(ev || []);
      } catch (e) {
        if (!cancelled)
          setEventsError(
            e instanceof Error ? e.message : "Не удалось загрузить события"
          );
      }

      setDilemmasError(null);
      try {
        const ds = await getDilemmas();
        if (!cancelled) setDilemmas(ds || []);
      } catch (e) {
        if (!cancelled)
          setDilemmasError(
            e instanceof Error ? e.message : "Не удалось загрузить дилеммы"
          );
      }

      setFollowupsError(null);
      try {
        const pf = await getPendingFollowups();
        if (!cancelled) setPendingFollowupsCount((pf || []).length);
      } catch (e) {
        if (!cancelled)
          setFollowupsError(
            e instanceof Error ? e.message : "Не удалось загрузить ожидающие фоллоу-апы"
          );
      }

      setInterviewError(null);
      try {
        const ia = await getInterviewAnswers();
        if (!cancelled) setInterviewAnswers(ia || []);
      } catch (e) {
        if (!cancelled)
          setInterviewError(
            e instanceof Error ? e.message : "Не удалось загрузить ответы интервью"
          );
      }

      setProjectsError(null);
      try {
        const ps = await getProjects();
        if (!cancelled) setProjects(ps || []);
      } catch (e) {
        if (!cancelled)
          setProjectsError(
            e instanceof Error ? e.message : "Не удалось загрузить проекты"
          );
      }

      setHypothesesError(null);
      try {
        const hs = await getHypotheses();
        if (!cancelled) setHypotheses(hs || []);
      } catch (e) {
        if (!cancelled)
          setHypothesesError(
            e instanceof Error ? e.message : "Не удалось загрузить гипотезы"
          );
      }

      setConnectionsError(null);
      try {
        const cs = await getCrossSphereInsights();
        if (!cancelled) setConnections(cs || []);
      } catch (e) {
        if (!cancelled)
          setConnectionsError(
            e instanceof Error ? e.message : "Не удалось загрузить связи"
          );
      }

      setObservationsError(null);
      try {
        const os = await getObservations();
        if (!cancelled) setObservations(os || []);
      } catch (e) {
        if (!cancelled)
          setObservationsError(
            e instanceof Error ? e.message : "Не удалось загрузить наблюдения"
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
  const interviewAnswersCount = (interviewAnswers || []).length;
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

  const heroNarrative = useMemo(() => {
    const top = unreadObservations[0];
    if (top) {
      return {
        kind: "observation" as const,
        lead: top.title,
        accent: null as string | null,
        rest: top.body,
      };
    }
    if (pendingFollowupsCount > 0) {
      return {
        kind: "followup" as const,
        lead: "Есть дилемма, которая ждёт твоего ответа.",
        accent: String(pendingFollowupsCount),
        rest: "Открой дилеммы и закрой фоллоу-ап — так я смогу учесть итог в следующих советах.",
      };
    }
    if (!noFinanceData && summary) {
      const topCat = financeTop2[0];
      const catLine = topCat
        ? `Крупнейшая статья: ${categoryLabel(topCat.category)} (${eur(topCat.amount)}).`
        : "";
      return {
        kind: "finance" as const,
        lead: "Сводка по последнему периоду загружена.",
        accent: eur(summary.total_spent),
        rest: [financePeriod ? `Период: ${financePeriod}.` : "", catLine].filter(Boolean).join(" "),
      };
    }
    return {
      kind: "empty" as const,
      lead: "Нет данных для анализа.",
      accent: null as string | null,
      rest: "Загрузи выписку Swedbank — тогда я смогу строить сводку и наблюдения.",
    };
  }, [
    unreadObservations,
    pendingFollowupsCount,
    noFinanceData,
    summary,
    financeTop2,
    financePeriod,
  ]);

  const criticalSignals = useMemo((): CriticalSignalRow[] => {
    const rows: CriticalSignalRow[] = [];

    if (pendingFollowupsCount > 0) {
      rows.push({
        key: "followup",
        title: "Фоллоу-ап по дилемме",
        description: "Нужен твой ответ, чтобы зафиксировать решение.",
        severity: "high",
        sphere: "Жизнь",
        href: "/dilemmas",
        rightMeta: `${pendingFollowupsCount} ждут`,
      });
    }

    if (pendingHypothesesCount > 0) {
      rows.push({
        key: "hypotheses",
        title: "Паттерны на проверку",
        description: "Подтверди или отклони гипотезы — это уточняет модель.",
        severity: "medium",
        sphere: "Паттерны",
        href: "/hypotheses",
        rightMeta: `${pendingHypothesesCount} на проверке`,
      });
    }

    if (openDilemmasCount > 0) {
      rows.push({
        key: "dilemmas-open",
        title: "Открытые дилеммы",
        description: "Есть разборы без закрытия статуса.",
        severity: "low",
        sphere: "Жизнь",
        href: "/dilemmas",
        rightMeta: `${openDilemmasCount} открыто`,
      });
    }

    for (const o of unreadObservations.slice(0, 3)) {
      rows.push({
        key: `obs-${o.id}`,
        title: o.title,
        description: o.body.length > 220 ? `${o.body.slice(0, 220)}…` : o.body,
        severity: observationSeverity(o),
        sphere: "Сигнал",
        rightMeta: observationTypeRu(o.observation_type),
      });
    }

    for (const c of connections.slice(0, 2)) {
      rows.push({
        key: `conn-${c.id}`,
        title: c.title,
        description: c.description.length > 220 ? `${c.description.slice(0, 220)}…` : c.description,
        severity: "medium",
        sphere: c.sphere1 && c.sphere2 ? `${c.sphere1}→${c.sphere2}` : "Cross",
        href: "/dashboard",
        rightMeta: c.confidence ?? undefined,
      });
    }

    return rows;
  }, [
    pendingFollowupsCount,
    pendingHypothesesCount,
    openDilemmasCount,
    unreadObservations,
    connections,
  ]);

  const pendingActionsCount = useMemo(() => {
    let n = 0;
    if (pendingFollowupsCount > 0) n += 1;
    if (pendingHypothesesCount > 0) n += 1;
    n += unreadObservations.length;
    n += Math.min(2, connections.length);
    if (openDilemmasCount > 0) n += 1;
    return n;
  }, [
    pendingFollowupsCount,
    pendingHypothesesCount,
    unreadObservations.length,
    connections.length,
    openDilemmasCount,
  ]);

  const financeSphere = useMemo(() => {
    if (summaryError) {
      return {
        value: "—",
        trend: "down" as const,
        detail: "ошибка",
      };
    }
    if (noFinanceData) {
      return { value: "—", trend: "down" as const, detail: "нет данных" };
    }
    const total = summary?.total_spent ?? 0;
    return {
      value: eur(total),
      trend: "up" as const,
      detail: financePeriod ? "Период" : "данные",
    };
  }, [summaryError, noFinanceData, summary, financePeriod]);

  const projectsSphere = useMemo(() => {
    if (projectsError) {
      return { value: "—", trend: "down" as const, detail: "ошибка" };
    }
    return {
      value: String(activeProjectsCount),
      trend: activeProjectsCount > 0 ? ("up" as const) : ("down" as const),
      detail: "Активных",
    };
  }, [projectsError, activeProjectsCount]);

  const lifeSphere = useMemo(() => {
    if (eventsError) {
      return { value: "—", trend: "down" as const, detail: "ошибка" };
    }
    return {
      value: String(eventsThisWeekCount),
      trend: eventsThisWeekCount > 0 ? ("up" as const) : ("down" as const),
      detail: "Событий / 7д",
    };
  }, [eventsError, eventsThisWeekCount]);

  return (
    <div className="relative -mx-6 -my-8 min-h-full bg-zinc-950 px-6 py-12 md:px-12 lg:px-16">
      <header className="mb-16">
        <div className="mb-4 flex items-center gap-4">
          <div className="h-px w-8 bg-brand-accent/50" />
          <p className="mono-label !tracking-[0.3em] text-zinc-500">
            Статус системы / Активен
          </p>
        </div>
        <h1 className="text-5xl font-light leading-tight tracking-tight text-white">
          Командный центр
        </h1>
      </header>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
        {/* Proactive advisor — real copy only */}
        <div className="group relative col-span-full overflow-hidden border-brand-accent/10 bg-brand-accent/[0.02] glass-card p-10">
          <div className="absolute right-0 top-0 p-8 opacity-20 transition-opacity group-hover:opacity-40">
            <IconActivity className="text-brand-accent animate-pulse-thin" />
          </div>
          <div className="relative z-10">
            <div className="mono-label mb-6 flex items-center gap-2 text-zinc-300">
              <span className="h-1 w-1 animate-pulse rounded-full bg-brand-accent" />
              Анализ данных
            </div>
            <div className="max-w-3xl text-2xl font-light leading-relaxed text-zinc-100">
              {heroNarrative.kind === "finance" && heroNarrative.accent ? (
                <p>
                  {heroNarrative.lead} Потрачено{" "}
                  <span className="border-b border-brand-accent/30 pb-0.5 text-brand-accent">
                    {heroNarrative.accent}
                  </span>
                  . {heroNarrative.rest}
                </p>
              ) : heroNarrative.kind === "followup" && heroNarrative.accent ? (
                <p>
                  {heroNarrative.lead}{" "}
                  <span className="border-b border-brand-accent/30 pb-0.5 text-brand-accent">
                    {heroNarrative.accent}
                  </span>{" "}
                  {heroNarrative.rest}
                </p>
              ) : (
                <p>
                  <span className="text-zinc-100">{heroNarrative.lead}</span>{" "}
                  {heroNarrative.rest}
                </p>
              )}
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-4">
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
                className="btn-primary disabled:opacity-60"
              >
                {obsGenerating ? "Генерирую…" : "Сгенерировать наблюдения"}
              </button>
              {obsInfo ? (
                <span className="text-xs font-mono text-zinc-600">{obsInfo}</span>
              ) : null}
              {heroNarrative.kind === "empty" ? (
                <Link href="/upload" className="btn-ghost">
                  Загрузить выписку
                </Link>
              ) : null}
            </div>
            {observationsError ? (
              <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-200">
                {observationsError}
              </div>
            ) : null}
          </div>
        </div>

        <OverviewSphereCard
          title="Финансы"
          icon={<IconWallet />}
          value={financeSphere.value}
          trend={financeSphere.trend}
          detail={financeSphere.detail}
        />
        <OverviewSphereCard
          title="Проекты"
          icon={<IconBriefcase />}
          value={projectsSphere.value}
          trend={projectsSphere.trend}
          detail={projectsSphere.detail}
        />
        <OverviewSphereCard
          title="Life"
          icon={<IconHeartPulse />}
          value={lifeSphere.value}
          trend={lifeSphere.trend}
          detail={lifeSphere.detail}
        />

        {/* Critical Signals — real rows only */}
        <div className="col-span-full mt-8">
          <div className="mb-8 flex items-center justify-between">
            <h3 className="text-lg font-light text-zinc-100">Критические сигналы</h3>
            <div className="mx-8 h-px flex-1 bg-white/5" />
            <div className="mono-label">
              Ожидают действия ({pendingActionsCount})
            </div>
          </div>

          {(eventsError ||
            dilemmasError ||
            followupsError ||
            interviewError ||
            hypothesesError ||
            connectionsError ||
            summaryError ||
            projectsError) && (
            <div className="mb-4 space-y-2">
              {summaryError ? (
                <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-200">
                  {summaryError}
                </div>
              ) : null}
              {projectsError ? (
                <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-200">
                  {projectsError}
                </div>
              ) : null}
              {eventsError ? (
                <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-200">
                  {eventsError}
                </div>
              ) : null}
              {dilemmasError ? (
                <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-200">
                  {dilemmasError}
                </div>
              ) : null}
              {followupsError ? (
                <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-200">
                  {followupsError}
                </div>
              ) : null}
              {interviewError ? (
                <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-200">
                  {interviewError}
                </div>
              ) : null}
              {hypothesesError ? (
                <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-200">
                  {hypothesesError}
                </div>
              ) : null}
              {connectionsError ? (
                <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-200">
                  {connectionsError}
                </div>
              ) : null}
            </div>
          )}

          <div className="flex flex-col gap-4">
            {criticalSignals.length === 0 ? (
              <div className="glass-card p-8 text-sm font-light text-zinc-500">
                Нет активных сигналов. Загрузи данные или сгенерируй наблюдения.
              </div>
            ) : (
              criticalSignals.map((row) => {
                const inner = (
                  <div className="glass-card flex cursor-pointer items-center justify-between p-6 transition-all duration-500 group-hover:border-white/20 group-hover:bg-white/[0.02]">
                    <div className="flex items-center gap-6">
                      <div
                        className={`rounded-md p-3 ${
                          row.severity === "high"
                            ? "border border-brand-danger/20 bg-brand-danger/10 text-brand-danger"
                            : row.severity === "medium"
                              ? "border border-brand-warning/20 bg-brand-warning/10 text-brand-warning"
                              : "border border-brand-accent/20 bg-brand-accent/10 text-brand-accent"
                        }`}
                      >
                        <IconAlertCircle strokeWidth={1.5} />
                      </div>
                      <div>
                        <p className="mb-1 text-base font-medium text-zinc-100 transition-colors group-hover:text-brand-accent">
                          {row.title}
                        </p>
                        <p className="max-w-md text-sm text-zinc-500">{row.description}</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 text-right">
                      <span className="rounded border border-white/5 bg-zinc-800 px-2 py-0.5 text-[9px] font-mono uppercase tracking-wider text-zinc-400">
                        {row.sphere}
                      </span>
                      {row.rightMeta ? (
                        <p className="font-mono text-[10px] text-zinc-600">{row.rightMeta}</p>
                      ) : null}
                    </div>
                  </div>
                );
                return row.href ? (
                  <Link key={row.key} href={row.href} className="group block">
                    {inner}
                  </Link>
                ) : (
                  <div key={row.key} className="group">
                    {inner}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Observation cards — read/mark flow preserved */}
        {unreadObservations.length > 0 ? (
          <div className="col-span-full mt-4 grid gap-4 lg:grid-cols-2">
            {unreadObservations.slice(0, 2).map((o) => (
              <ObservationCard
                key={o.id}
                observation={o}
                onRead={(u) =>
                  setObservations((prev) => prev.map((x) => (x.id === u.id ? u : x)))
                }
              />
            ))}
          </div>
        ) : null}

        {/* Finance + life detail strip — same links/data as before */}
        <div className="col-span-full mt-8 grid gap-8 lg:grid-cols-2">
          <div className="glass-card p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="mono-label mb-2 text-zinc-300">Финансы</div>
                <h2 className="text-lg font-light text-zinc-100">Сводка</h2>
                <p className="mt-2 text-sm font-light text-zinc-500">
                  Сводка трат за последний период
                </p>
              </div>
              <Link href="/dashboard" className="btn-ghost shrink-0 px-3 py-2 text-xs">
                Дашборд →
              </Link>
            </div>
            {summaryError ? (
              <div className="mt-5 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-200">
                {summaryError}
              </div>
            ) : noFinanceData ? (
              <div className="mt-6 rounded-lg border border-white/5 bg-white/[0.02] px-4 py-3 text-sm text-zinc-300">
                Нет данных — загрузи выписку
                <div className="mt-3">
                  <Link href="/upload" className="btn-primary inline-flex">
                    Загрузить выписку
                  </Link>
                </div>
              </div>
            ) : (
              <div className="mt-6">
                <div className="mono-label text-zinc-500">ПОТРАЧЕНО</div>
                <div className="mt-2 text-3xl font-light tabular-nums text-zinc-100">
                  {eur(summary?.total_spent ?? 0)}
                </div>
                {financePeriod ? (
                  <p className="mt-2 text-sm text-zinc-500">{financePeriod}</p>
                ) : null}
                {financeTop2.length ? (
                  <div className="mt-4 grid gap-2">
                    {financeTop2.map((c) => (
                      <div key={c.category} className="flex items-center justify-between text-sm">
                        <span className="text-zinc-400">{categoryLabel(c.category)}</span>
                        <span className="font-mono tabular-nums text-zinc-200">{eur(c.amount)}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className="glass-card p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="mono-label mb-2 text-zinc-300">Жизнь</div>
                <h2 className="text-lg font-light text-zinc-100">Жизнь</h2>
                <p className="mt-2 text-sm font-light text-zinc-500">
                  События и контекст
                </p>
              </div>
              <Link href="/events" className="btn-ghost shrink-0 px-3 py-2 text-xs">
                События →
              </Link>
            </div>
            {eventsError ? (
              <div className="mt-5 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-200">
                {eventsError}
              </div>
            ) : dilemmasError ? (
              <div className="mt-5 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-200">
                {dilemmasError}
              </div>
            ) : followupsError ? (
              <div className="mt-5 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-200">
                {followupsError}
              </div>
            ) : interviewError ? (
              <div className="mt-5 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-200">
                {interviewError}
              </div>
            ) : (
              <div className="mt-6">
                <div className="mono-label text-zinc-500">СОБЫТИЙ ЗА 7 ДНЕЙ</div>
                <div className="mt-2 text-3xl font-light tabular-nums text-zinc-100">
                  {eventsThisWeekCount}
                </div>
                {openDilemmasCount > 0 ? (
                  <div className="mt-3 text-sm text-zinc-400">
                    Открытых дилемм:{" "}
                    <Link href="/dilemmas" className="font-medium text-zinc-100 hover:underline">
                      {openDilemmasCount}
                    </Link>
                  </div>
                ) : null}
                {pendingFollowupsCount > 0 ? (
                  <Link
                    href="/dilemmas"
                    className="mt-4 block rounded-lg border border-brand-warning/20 bg-brand-warning/5 px-4 py-3 text-sm font-medium text-brand-warning"
                  >
                    AIR4 ждёт ответа по дилемме ({pendingFollowupsCount})
                  </Link>
                ) : null}
                {interviewAnswersCount < 5 ? (
                  <div className="mt-3 text-sm text-zinc-400">
                    <Link href="/interview" className="font-medium text-zinc-100 hover:underline">
                      AIR4 хочет узнать тебя лучше →
                    </Link>
                  </div>
                ) : null}
                <div className="mt-5 grid gap-3">
                  {last2Events.length === 0 ? (
                    <p className="text-sm text-zinc-500">
                      Событий пока нет. Расскажи AIR4 о своей жизни в чате.
                    </p>
                  ) : (
                    last2Events.map((e) => (
                      <div
                        key={e.id}
                        className="rounded-lg border border-white/5 bg-white/[0.02] px-4 py-3 text-sm text-zinc-300"
                      >
                        <span className="font-medium text-zinc-100">{e.title}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Projects — same as before */}
        <div className="col-span-full glass-card p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="mono-label mb-2 text-zinc-300">Проекты</div>
              <h2 className="text-lg font-light text-zinc-100">Проекты</h2>
              <p className="mt-2 text-sm font-light text-zinc-500">Активные проекты и прогресс</p>
            </div>
            <Link href="/projects" className="btn-ghost shrink-0 px-3 py-2 text-xs">
              Открыть →
            </Link>
          </div>
          {projectsError ? (
            <div className="mt-5 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-200">
              {projectsError}
            </div>
          ) : projects.length === 0 ? (
            <div className="mt-6 rounded-lg border border-white/5 bg-white/[0.02] px-4 py-3 text-sm text-zinc-300">
              Проектов пока нет.
              <div className="mt-3">
                <Link href="/projects" className="btn-primary inline-flex">
                  Добавить проект
                </Link>
              </div>
            </div>
          ) : (
            <div className="mt-6">
              <div className="mono-label text-zinc-500">АКТИВНЫХ ПРОЕКТОВ</div>
              <div className="mt-2 text-3xl font-light tabular-nums text-zinc-100">
                {activeProjectsCount}
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {last2Projects.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-4 py-3"
                  >
                    <span className="text-sm font-medium text-zinc-100">{p.name}</span>
                    <span className="rounded border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-zinc-400">
                      {p.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Patterns card when pending — same link */}
        {pendingHypothesesCount > 0 ? (
          <div className="col-span-full glass-card p-8 lg:col-span-1">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="mono-label mb-2 text-zinc-300">Паттерны</div>
                <div className="text-2xl font-light tabular-nums text-zinc-100">
                  {pendingHypothesesCount}
                </div>
                <p className="mt-2 text-sm font-light text-zinc-500">
                  AIR4 хочет задать тебе вопросы
                </p>
              </div>
              <Link href="/hypotheses" className="btn-ghost shrink-0 px-3 py-2 text-xs">
                Открыть →
              </Link>
            </div>
          </div>
        ) : null}

        {/* Health soon — unchanged intent */}
        <div className="col-span-full glass-card p-8 opacity-60">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="mono-label mb-2 text-zinc-300">Здоровье</div>
              <h2 className="text-lg font-light text-zinc-100">Здоровье и спорт</h2>
              <p className="mt-2 text-sm font-light text-zinc-500">Тренировки, сон и энергия</p>
            </div>
            <span className="rounded border border-white/10 bg-white/[0.03] px-2 py-1 text-[10px] font-mono text-zinc-400">
              Скоро
            </span>
          </div>
        </div>

        {hasConnections ? (
          <section className="col-span-full glass-card p-8">
            <div className="mb-6 flex items-center justify-between gap-3">
              <div className="mono-label text-zinc-300">AIR4 нашёл связи</div>
              <Link href="/dashboard" className="btn-ghost px-3 py-2 text-xs">
                Смотреть все →
              </Link>
            </div>
            {connectionsError ? (
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-200">
                {connectionsError}
              </div>
            ) : (
              <div className="grid gap-4">
                {connections.slice(0, 2).map((ins) => (
                  <CrossSphereCard key={ins.id} insight={ins} />
                ))}
              </div>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}
