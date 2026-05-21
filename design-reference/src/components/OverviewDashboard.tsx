import { Scale } from "lucide-react";
import {
  bmiFromMetrics,
  formatCategoryLabel,
  formatEuro,
  hasFinanceData,
  hasHealthData,
  latestBodyHeight,
  latestBodyWeight,
  latestMetricLogDate,
  topCategory,
  type BodyMetric,
  type Dilemma,
  type Observation,
  type Project,
  type Summary,
  type Workout,
} from "../lib/api";
import { formatProjectStatus, formatRelativeActivity, formatWorkoutType } from "../lib/format";
import { Page } from "../types";
import { cn } from "../lib/utils";
import { OverviewCardEmpty } from "./OverviewCardEmpty";

const StatusDot = ({ color = "#ef4444" }: { color?: string }) => (
  <div className="absolute top-3 right-3 w-4 h-4 flex items-center justify-center pointer-events-none">
    <div
      className="absolute w-4 h-4 rounded-full opacity-50 animate-ping"
      style={{ backgroundColor: color }}
    />
    <div className="relative w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
  </div>
);

function sparklineHeights(summary: Summary): number[] {
  const entries = Object.entries(summary.by_category ?? {})
    .filter(([key]) => key !== "internal_transfers")
    .sort((a, b) => b[1].amount - a[1].amount)
    .slice(0, 7);
  if (!entries.length) return [];
  const max = Math.max(...entries.map(([, v]) => v.amount), 1);
  return entries.map(([, v]) => Math.round((v.amount / max) * 100));
}

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
  const topCat = topCategory(summary);
  const periodLabel =
    summary?.period_start && summary?.period_end
      ? `${summary.period_start} — ${summary.period_end}`
      : null;
  const sparkHeights = summary ? sparklineHeights(summary) : [];
  const hasObservations = observations.length > 0;
  const latestWeight = latestBodyWeight(bodyMetrics);
  const latestHeight = latestBodyHeight(bodyMetrics);
  const bmi = bmiFromMetrics(bodyMetrics);
  const lastLogDate = latestMetricLogDate(bodyMetrics);
  const latestWorkout = workouts[0] ?? null;
  const showHealth = hasHealthData(bodyMetrics, workouts);
  const healthLoading =
    loading && bodyMetrics.length === 0 && workouts.length === 0;

  return (
    <div className="grid grid-cols-3 grid-rows-[repeat(3,minmax(200px,auto))] gap-6 h-full pb-10">
      {/* Projects — span 2 */}
      <div className="col-span-2 bg-white rounded-[20px] p-6 flex flex-col shadow-[0_2px_12px_rgba(0,0,0,0.08)] relative min-h-[220px]">
        {activeProjects.length > 0 && <StatusDot color="#f59e0b" />}
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-[11px] font-bold text-[#9ca3af] uppercase tracking-[0.1em]">
            Projects
          </h2>
          {!loading && projects.length > 0 && (
            <span className="text-[10px] font-mono text-[#9ca3af] uppercase">
              {activeProjects.length} active
            </span>
          )}
        </div>

        {loading ? (
          <p className="text-[14px] text-[#9ca3af]">Loading…</p>
        ) : projects.length === 0 ? (
          <OverviewCardEmpty
            type="projects"
            compact
            onAction={() => onOpenChatWithMessage("Я хочу добавить проект")}
          />
        ) : (
          <div className="space-y-5 flex-1">
            {projects.slice(0, 4).map((p) => {
              const activity = formatRelativeActivity(p.updated_at);
              return (
                <div
                  key={p.id}
                  className={cn(
                    "flex items-center justify-between gap-4 border-b border-gray-50 pb-4 last:border-0 last:pb-0",
                    p.status !== "active" && "opacity-70"
                  )}
                >
                  <div className="min-w-0">
                    <span className="text-[15px] font-bold text-[#374151] block truncate">
                      {p.name}
                    </span>
                    <span className="text-[12px] text-[#9ca3af] mt-0.5 block">{activity}</span>
                  </div>
                  <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-gray-50 text-[#6b7280]">
                    {formatProjectStatus(p.status)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Health */}
      <div className="bg-white rounded-[20px] p-6 flex flex-col shadow-[0_2px_12px_rgba(0,0,0,0.08)] relative min-h-[220px]">
        <h2 className="text-[11px] font-bold text-[#9ca3af] uppercase tracking-[0.1em] mb-2">
          Health
        </h2>
        {healthLoading ? (
          <p className="text-[14px] text-[#9ca3af]">Loading…</p>
        ) : !showHealth ? (
          <OverviewCardEmpty type="health" compact />
        ) : (
          <div className="flex-1 flex flex-col justify-between gap-3">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              {latestWeight && (
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase mb-0.5">Weight</p>
                  <span className="font-mono text-2xl font-black text-[#111827]">
                    {latestWeight.weight}
                  </span>
                  <span className="text-sm font-bold text-gray-400 ml-0.5">kg</span>
                </div>
              )}
              {latestHeight && (
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase mb-0.5">Height</p>
                  <span className="font-mono text-2xl font-black text-[#111827]">
                    {latestHeight.height}
                  </span>
                  <span className="text-sm font-bold text-gray-400 ml-0.5">cm</span>
                </div>
              )}
              {bmi != null && latestWeight && latestHeight && (
                <div className="col-span-2">
                  <p className="text-[10px] font-bold text-gray-400 uppercase mb-0.5">BMI</p>
                  <span className="font-mono text-2xl font-black text-indigo-600">{bmi}</span>
                </div>
              )}
            </div>
            {lastLogDate && (
              <p className="text-[12px] text-[#6b7280] font-medium">
                Last logged · {lastLogDate}
              </p>
            )}
            {latestWorkout && (
              <p className="text-[11px] text-[#9ca3af] font-medium">
                Workout: {formatWorkoutType(latestWorkout.type)} · {latestWorkout.date}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Finance — unchanged */}
      <div className="bg-white rounded-[20px] p-6 flex flex-col justify-between shadow-[0_2px_12px_rgba(0,0,0,0.08)] relative min-h-[220px]">
        {hasFinance && <StatusDot color="#ef4444" />}
        <div className="flex justify-between items-start gap-2 mb-2">
          <h2 className="text-[11px] font-bold text-[#9ca3af] uppercase tracking-[0.1em]">
            Finance
          </h2>
          {hasFinance && periodLabel && (
            <span className="bg-indigo-50 text-indigo-600 text-[10px] font-mono px-2.5 py-1 rounded-full font-bold uppercase tracking-wider leading-none truncate max-w-[55%]">
              {periodLabel}
            </span>
          )}
        </div>

        {loading && !summary ? (
          <p className="text-[14px] text-[#9ca3af]">Loading…</p>
        ) : !hasFinance ? (
          <OverviewCardEmpty
            type="finance"
            compact
            onAction={() => onPageChange("CSVUpload")}
          />
        ) : (
          <div className="flex-1 flex flex-col justify-between">
            <div>
              <span className="font-mono text-4xl font-black tracking-tight text-[#111827]">
                {formatEuro(summary!.total_spent)}
              </span>
              {topCat && (
                <p className="text-[12px] text-[#6b7280] mt-2 font-medium">
                  Top: {formatCategoryLabel(topCat[0])} — {formatEuro(topCat[1].amount)}
                </p>
              )}
            </div>
            {sparkHeights.length > 0 && (
              <div className="flex items-end gap-[3px] h-[28px] mt-5">
                {sparkHeights.map((h, i) => (
                  <div
                    key={i}
                    className={cn(
                      "w-full rounded-sm transition-all",
                      i === sparkHeights.length - 1 ? "bg-[#ef4444]" : "bg-[#e5e7eb]"
                    )}
                    style={{ height: `${Math.max(12, h)}%` }}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Observations (rule + LLM signals — distinct from Patterns / hypotheses) */}
      <div className="col-span-2 bg-white rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)] relative min-h-[160px] flex flex-col">
        <h2 className="text-[11px] font-bold text-[#9ca3af] uppercase tracking-[0.1em] mb-4">
          Observations
        </h2>
        {loading ? (
          <p className="text-[14px] text-[#9ca3af]">Loading…</p>
        ) : hasObservations ? (
          <div className="space-y-4 flex-1">
            {observations.slice(0, 2).map((obs) => (
              <div key={obs.id} className="border-l-4 border-indigo-500 pl-4 py-1">
                <p className="text-[14px] font-bold text-[#111827]">{obs.title}</p>
                <p className="text-[13px] text-[#6b7280] mt-1 leading-relaxed line-clamp-2">
                  {obs.body}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <OverviewCardEmpty type="patterns" compact />
        )}
      </div>

      {/* Dilemma — only when open */}
      {openDilemma && (
        <div className="col-span-3 bg-white rounded-[20px] p-6 flex items-center justify-between shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
          <div className="flex gap-8 items-center min-w-0">
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
              <Scale size={24} />
            </div>
            <div className="min-w-0">
              <h2 className="text-[11px] font-bold text-[#9ca3af] uppercase tracking-[0.1em] mb-1">
                Active Dilemma
              </h2>
              <p className="text-[16px] font-bold text-[#111827]">{openDilemma.title}</p>
              {openDilemma.description && (
                <p className="text-[13px] text-[#6b7280] mt-1 line-clamp-1">
                  {openDilemma.description}
                </p>
              )}
            </div>
          </div>
          <span className="text-[10px] font-mono text-amber-600 uppercase font-bold shrink-0 ml-4">
            {openDilemma.status}
          </span>
        </div>
      )}
    </div>
  );
}
