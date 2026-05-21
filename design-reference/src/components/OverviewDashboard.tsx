import { useMemo } from "react";
import { Scale, ChevronRight, Sparkles } from "lucide-react";
import {
  bmiFromMetrics,
  formatCategoryLabel,
  formatEuro,
  hasFinanceData,
  latestBodyWeight,
  type BodyMetric,
  type Dilemma,
  type Observation,
  type Project,
  type Summary,
  type Workout,
} from "../lib/api";
import { daysSince, formatRelativeActivity } from "../lib/format";
import { cn } from "../lib/utils";
import { t } from "../lib/typography";
import { Page } from "../types";
import { AIRCheckIn } from "./AIRCheckIn";
import { OverviewCardEmpty } from "./OverviewCardEmpty";

type Props = {
  summary: Summary | null;
  projects: Project[];
  observations: Observation[];
  bodyMetrics: BodyMetric[];
  workouts: Workout[];
  loading: boolean;
  openDilemma: Dilemma | null;
  activeProjects: Project[];
  onPageChange: (page: Page) => void;
  onOpenChatWithMessage: (text: string) => void;
};

const CATEGORY_COLORS = ["bg-red-500", "bg-green-500", "bg-orange-500", "bg-blue-500"];

function isoMinusDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function monthShort(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleString("en-US", { month: "short" });
}

function projectMomentum(updatedAt: string | null | undefined): {
  days: number;
  momentum: number;
  color: string;
} {
  const days = updatedAt ? daysSince(updatedAt) : 999;
  let color = "bg-green-500";
  let momentum = 90;
  if (days >= 14) {
    color = "bg-red-500";
    momentum = 15;
  } else if (days >= 7) {
    color = "bg-yellow-500";
    momentum = 30;
  } else if (days >= 3) {
    color = "bg-yellow-400";
    momentum = 55;
  } else {
    momentum = Math.max(60, 95 - days * 8);
  }
  return { days, momentum, color };
}

export function OverviewDashboard({
  summary,
  projects,
  observations,
  bodyMetrics,
  workouts,
  loading,
  openDilemma,
  activeProjects,
  onPageChange,
  onOpenChatWithMessage,
}: Props) {
  const hasFinance = hasFinanceData(summary);

  // --- Finance derived ---
  const totalSpent = summary?.total_spent ?? 0;
  const totalIncome = summary?.total_income ?? 0;
  const freeCapital = totalIncome - totalSpent;
  const periodLabel = useMemo(() => {
    const a = monthShort(summary?.period_start ?? null);
    const b = monthShort(summary?.period_end ?? null);
    if (a && b) return a === b ? a : `${a}–${b}`;
    return null;
  }, [summary?.period_start, summary?.period_end]);

  const topCategories = useMemo(() => {
    if (!summary) return [] as Array<[string, number]>;
    return Object.entries(summary.by_category ?? {})
      .filter(([k]) => k !== "internal_transfers")
      .map(([k, v]) => [k, v.amount] as [string, number])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
  }, [summary]);
  const maxCatAmount = topCategories[0]?.[1] ?? 1;

  // --- Health derived ---
  const latestWeight = latestBodyWeight(bodyMetrics);
  const bmi = bmiFromMetrics(bodyMetrics);
  const weightLabel = latestWeight ? `${latestWeight.weight} kg` : "—";
  const bmiLabel = bmi != null ? `BMI ${bmi}` : null;

  // --- Workout streak (last 7 days, oldest → today) ---
  const streak = useMemo(() => {
    const dates = new Set(workouts.map((w) => w.date));
    return Array.from({ length: 7 }, (_, i) => dates.has(isoMinusDays(6 - i)));
  }, [workouts]);

  const latestWorkoutDate = workouts[0]?.date ?? null;
  const daysSinceWorkout = latestWorkoutDate ? daysSince(latestWorkoutDate) : null;
  const lastWorkoutLabel = latestWorkoutDate
    ? new Date(latestWorkoutDate).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    : "—";

  // --- Projects derived ---
  const totalProjects = projects.length;
  const stalledProjects = projects.filter(
    (p) => p.status === "active" && daysSince(p.updated_at) > 7
  ).length;

  const topProjects = useMemo(() => {
    const sorted = [...projects].sort((a, b) => {
      const da = daysSince(a.updated_at);
      const db = daysSince(b.updated_at);
      return da - db;
    });
    return sorted.slice(0, 3).map((p) => ({
      ...p,
      ...projectMomentum(p.updated_at),
      activity: formatRelativeActivity(p.updated_at),
    }));
  }, [projects]);

  const overallMomentum =
    topProjects.length === 0
      ? 0
      : Math.round(
          topProjects.reduce((acc, p) => acc + p.momentum, 0) / topProjects.length
        );

  // --- Dilemma derived ---
  const dilemmaDays = openDilemma?.created_at
    ? daysSince(openDilemma.created_at)
    : null;

  const handleProjectClick = (_id: number) => {
    onPageChange("Projects");
  };

  // First-load skeleton — keep simple
  if (loading && !summary && projects.length === 0 && workouts.length === 0) {
    return (
      <div className="text-[14px] text-gray-400 px-2 py-12">Loading overview…</div>
    );
  }

  return (
    <div className="space-y-6 pb-12 font-sans bg-[#F5F5F7]">
      {/* -------------------- Row 1: 3 hero cards -------------------- */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Card 1.1 — Total Spent */}
        <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_16px_rgba(0,0,0,0.06)] flex flex-col justify-between transition-all duration-300 hover:shadow-md h-[180px]">
          <div>
            <span className={cn(t.cardLabel, "block mb-2")}>
              Total Spent
            </span>
            <span className={t.hero}>
              {hasFinance ? formatEuro(totalSpent) : "—"}
            </span>
          </div>

          <div className="flex gap-6 mt-auto">
            <div className="space-y-0.5">
              <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">
                Income
              </span>
              <span className="text-[13px] font-extrabold text-gray-500 font-mono">
                {hasFinance && totalIncome > 0 ? formatEuro(totalIncome) : "—"}
              </span>
            </div>
            <div className="space-y-0.5">
              <span className="text-[9px] font-bold text-[#6366F1] uppercase tracking-wider block">
                Free
              </span>
              <span
                className={cn(
                  "text-[13px] font-extrabold font-mono",
                  freeCapital >= 0 ? "text-green-600" : "text-red-500"
                )}
              >
                {hasFinance && totalIncome > 0 ? formatEuro(freeCapital) : "—"}
              </span>
            </div>
          </div>
        </div>

        {/* Card 1.2 — Health Weight + streak */}
        <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_16px_rgba(0,0,0,0.06)] flex flex-col justify-between transition-all duration-300 hover:shadow-md h-[180px]">
          <div>
            <span className={cn(t.cardLabel, "block mb-2")}>
              Health Weight
            </span>
            <div className="flex items-baseline gap-2">
              <span className={t.hero}>
                {weightLabel}
              </span>
              {bmiLabel && (
                <span className={t.heroSub}>{bmiLabel}</span>
              )}
            </div>
          </div>

          <div className="space-y-1 mt-auto">
            <span className="text-[9.5px] font-bold text-gray-400 uppercase tracking-wider block">
              Last 7 days
            </span>
            <div className="flex items-center gap-1">
              {streak.map((trained, i) => (
                <span
                  key={i}
                  className={cn(
                    "text-[17px] leading-none",
                    trained ? "text-[#6366F1]" : "text-gray-200"
                  )}
                >
                  ●
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Card 1.3 — Active Projects */}
        <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_16px_rgba(0,0,0,0.06)] flex flex-col justify-between transition-all duration-300 hover:shadow-md h-[180px]">
          <div>
            <span className={cn(t.cardLabel, "block mb-2")}>
              Active Projects
            </span>
            <div className="flex items-baseline justify-between">
              <span className={t.hero}>
                {totalProjects}
              </span>
              {stalledProjects > 0 && (
                <span className="text-xs font-black text-red-500 uppercase tracking-wide bg-red-50 border border-red-100 px-2.5 py-0.5 rounded-full">
                  {stalledProjects} Stalled
                </span>
              )}
            </div>
          </div>

          <div className="bg-[#F5F5F7]/30 rounded-xl p-3 flex items-center justify-between mt-auto">
            <div className="space-y-0.5">
              <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">
                Last Workout
              </span>
              <span className="text-[11px] font-extrabold text-gray-700">
                {lastWorkoutLabel}
              </span>
            </div>
            {daysSinceWorkout != null ? (
              daysSinceWorkout >= 3 ? (
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-[10px] font-bold text-red-500 uppercase">
                    {daysSinceWorkout} days without training
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                  <span className="text-[10px] font-bold text-green-600 uppercase">
                    on streak
                  </span>
                </div>
              )
            ) : (
              <span className="text-[10px] font-bold text-gray-400 uppercase">
                no workouts yet
              </span>
            )}
          </div>
        </div>
      </div>

      {/* -------------------- AIR4 Check-in -------------------- */}
      <AIRCheckIn
        onTellInChat={(question) => onOpenChatWithMessage(question)}
      />

      {/* -------------------- Row 2: Finance (2/3) + Projects (1/3) -------------------- */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Card 2.1 — Finance Spend Chart */}
        <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_16px_rgba(0,0,0,0.06)] flex flex-col justify-between min-h-[340px] md:col-span-2 transition-all duration-300 hover:shadow-md">
          <div className="space-y-4">
            <div className="flex justify-between items-start">
              <div>
                <span className={cn(t.cardLabel, "block mb-1")}>
                  Finance Spend Chart
                </span>
                <span className="text-lg font-extrabold text-gray-900">
                  Allocation Breakdown
                </span>
              </div>
              {periodLabel && (
                <span className="bg-indigo-50 text-[#6366F1] text-[9.5px] font-black px-3 py-1 rounded-full uppercase tracking-wider font-mono shadow-sm">
                  {periodLabel}
                </span>
              )}
            </div>

            {topCategories.length > 0 ? (
              <div className="space-y-5 pt-3">
                {topCategories.map(([key, amount], i) => {
                  const pct = Math.max(4, Math.round((amount / maxCatAmount) * 100));
                  return (
                    <div
                      key={key}
                      className="flex justify-between items-center text-[11px] font-bold text-gray-600"
                    >
                      <span className="w-24 uppercase tracking-wider text-left truncate">
                        {formatCategoryLabel(key)}
                      </span>
                      <div className="flex-1 mx-4 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full",
                            CATEGORY_COLORS[i] ?? "bg-gray-400"
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="font-mono w-16 text-right text-gray-700">
                        {formatEuro(amount)}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="pt-6">
                <OverviewCardEmpty
                  type="finance"
                  compact
                  onAction={() => onPageChange("CSVUpload")}
                />
              </div>
            )}
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-gray-50 mt-4">
            {hasFinance && totalIncome > 0 ? (
              <span
                className={cn(
                  "text-sm font-extrabold uppercase tracking-wider",
                  freeCapital >= 0 ? "text-green-600" : "text-red-500"
                )}
              >
                FREE CAPITAL: {formatEuro(freeCapital)}
              </span>
            ) : (
              <span className="text-sm font-extrabold text-gray-400 uppercase tracking-wider">
                FREE CAPITAL: —
              </span>
            )}
            <button
              type="button"
              onClick={() => onPageChange("Finance")}
              className={cn(t.link, "hover:text-indigo-800 flex items-center gap-0.5")}
            >
              Analyze Ledgers
              <ChevronRight size={12} />
            </button>
          </div>
        </div>

        {/* Card 2.2 — Projects Directory */}
        <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_16px_rgba(0,0,0,0.06)] flex flex-col justify-between min-h-[340px] transition-all duration-300 hover:shadow-md">
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className={t.cardLabel}>
                Projects Directory
              </span>
              <button
                type="button"
                onClick={() => onPageChange("Projects")}
                className={cn(t.link, "hover:text-indigo-800 flex items-center gap-0.5")}
              >
                All
                <ChevronRight size={12} />
              </button>
            </div>

            {topProjects.length === 0 ? (
              <OverviewCardEmpty
                type="projects"
                compact
                onAction={() => onOpenChatWithMessage("Я хочу добавить проект")}
              />
            ) : (
              <div className="space-y-5">
                {topProjects.map((p) => (
                  <div
                    key={p.id}
                    onClick={() => handleProjectClick(p.id)}
                    className="cursor-pointer group/proj block space-y-2"
                  >
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-[13px] font-extrabold text-gray-800 group-hover/proj:text-[#6366F1] transition-colors truncate">
                          {p.name}
                        </span>
                        <span
                          className={cn(
                            "text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0",
                            p.status === "active"
                              ? "bg-indigo-50 text-[#6366F1]"
                              : "bg-gray-100 text-gray-500"
                          )}
                        >
                          {p.status}
                        </span>
                      </div>
                      <span className="text-[10px] text-gray-400 font-semibold font-mono shrink-0">
                        {p.activity}
                      </span>
                    </div>

                    <div className="h-[4px] w-full bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-500",
                          p.color
                        )}
                        style={{ width: `${p.momentum}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between pt-2">
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
              {activeProjects.length} active
              {topProjects.length > 0 && ` · Momentum ${overallMomentum}%`}
            </p>
          </div>
        </div>
      </div>

      {/* -------------------- Row 3: Observations -------------------- */}
      <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_16px_rgba(0,0,0,0.06)] flex flex-col justify-between transition-all duration-300 hover:shadow-md">
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <span className={t.cardLabel}>
              Observed Patterns
            </span>
            <button
              type="button"
              onClick={() => onPageChange("Patterns")}
              className={cn(t.link, "hover:text-indigo-800 flex items-center gap-0.5")}
            >
              Chronicle
              <ChevronRight size={12} />
            </button>
          </div>

          {observations.length === 0 ? (
            <OverviewCardEmpty type="patterns" compact />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-1">
              {observations.slice(0, 2).map((obs) => (
                <div
                  key={obs.id}
                  className="pl-4 border-l-2 border-l-[#6366F1] py-1 space-y-1"
                >
                  <span className="text-[9px] font-bold text-[#6366F1] uppercase tracking-wider block">
                    {obs.title}
                  </span>
                  <p className="text-[11.5px] text-gray-600 font-semibold leading-relaxed italic line-clamp-3">
                    “{obs.body}”
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {observations.length > 0 && (
          <div className="flex items-center justify-between pt-4 border-t border-gray-50 mt-5">
            <div className="flex items-center gap-2">
              <Sparkles size={13} className="text-[#6366F1]" />
              <span className="text-[11px] font-black uppercase tracking-wider bg-indigo-50 text-indigo-700 px-3 py-1 rounded-full">
                {observations.length} {observations.length === 1 ? "anomaly" : "anomalies"} detected
              </span>
            </div>
            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">
              AI Assessment aligned
            </span>
          </div>
        )}
      </div>

      {/* -------------------- Row 4: Active Dilemma -------------------- */}
      {openDilemma && (
        <div
          onClick={() => onPageChange("Dilemmas")}
          className="bg-white rounded-[20px] p-6 shadow-[0_2px_16px_rgba(0,0,0,0.06)] hover:shadow-md cursor-pointer transition-all flex flex-col md:flex-row md:items-center justify-between gap-6 group"
        >
          <div className="flex items-center gap-5 flex-1 min-w-0">
            <div className="w-11 h-11 rounded-2xl bg-amber-50 flex items-center justify-center text-amber-500 shrink-0">
              <Scale size={20} />
            </div>
            <div className="space-y-1.5 min-w-0">
              <div className="flex items-center gap-2.5">
                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest leading-none">
                  Primary Dilemma
                </span>
                <span className="bg-green-50 text-green-600 border border-green-200 text-[8.5px] font-black px-2 py-0.5 rounded uppercase tracking-wider">
                  {openDilemma.status}
                </span>
              </div>

              <p className="text-[15px] font-black text-gray-900 group-hover:text-[#6366F1] transition-colors tracking-tight">
                {openDilemma.title}
              </p>

              {openDilemma.description && (
                <p className="text-xs text-gray-500 font-semibold leading-relaxed line-clamp-2">
                  {openDilemma.description}
                </p>
              )}
            </div>
          </div>

          {dilemmaDays != null && (
            <div className="flex md:flex-col items-end gap-2 justify-between md:justify-center shrink-0">
              <div className="text-right">
                <span className="text-[9px] font-black text-red-400 block uppercase tracking-widest">
                  Timeline
                </span>
                <span className="font-mono text-sm font-black text-red-500">
                  {dilemmaDays} {dilemmaDays === 1 ? "Day" : "Days"} Open
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
