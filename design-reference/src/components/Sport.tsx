import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Activity,
  Bell,
  Clock,
  Dumbbell,
  Flame,
  History,
  Plus,
  Scale,
  TrendingDown,
  TrendingUp,
  X,
  Zap,
} from "lucide-react";
import { cn } from "../lib/utils";
import { t } from "../lib/typography";
import {
  bmiFromMetrics,
  fetchBodyMetrics,
  fetchWorkouts,
  latestBodyHeight,
  latestBodyWeight,
  logBodyMetric,
  logWorkout,
  type BodyMetric,
  type Workout,
} from "../lib/api";
import { formatWorkoutType } from "../lib/format";

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const StatusDot = ({ color = "#ef4444" }: { color?: string }) => (
  <div className="absolute top-3 right-3 w-4 h-4 flex items-center justify-center pointer-events-none">
    <div className="absolute w-4 h-4 rounded-full opacity-50 animate-ping" style={{ backgroundColor: color }} />
    <div className="relative w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
  </div>
);

function formatVolume(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)}t`;
  }
  return `${Math.round(value)} kg`;
}

function parseIsoDate(iso: string): Date | null {
  const normalized = iso.includes("T") ? iso : `${iso}T12:00:00Z`;
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatChartDate(iso: string): string {
  const d = parseIsoDate(iso);
  if (!d) return iso;
  return `${MONTH_LABELS[d.getMonth()]} ${String(d.getDate()).padStart(2, "0")}`;
}

function daysSinceIso(iso: string, now: Date = new Date()): number {
  const d = parseIsoDate(iso);
  if (!d) return 0;
  return Math.max(0, Math.floor((now.getTime() - d.getTime()) / 86_400_000));
}

function bmiCategoryLabel(bmi: number): { label: string; className: string } {
  if (bmi < 18.5) return { label: "Status: Underweight", className: "text-amber-500" };
  if (bmi < 25) return { label: "Status: Normal range", className: "text-emerald-600" };
  if (bmi < 30) return { label: "Status: Overweight Class 1", className: "text-rose-500" };
  return { label: "Status: Obesity", className: "text-rose-600" };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function WorkoutDetailsModal({
  workout,
  onClose,
}: {
  workout: Workout;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="relative bg-white rounded-[20px] shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-colors"
        >
          <X size={20} />
        </button>

        <div className="p-7">
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.2em]">
            {workout.date}
          </p>
          <h2 className={cn(t.pageTitle, "mt-1")}>
            {formatWorkoutType(workout.type)}
          </h2>

          <div className="flex flex-wrap gap-x-6 gap-y-2 mt-4 text-[13px] text-gray-600">
            {workout.duration != null && (
              <span>
                <span className="text-gray-400">Duration:</span>{" "}
                <span className="font-bold text-gray-900">{workout.duration} min</span>
              </span>
            )}
            {workout.total_volume != null && workout.total_volume > 0 && (
              <span>
                <span className="text-gray-400">Volume:</span>{" "}
                <span className="font-bold text-gray-900">{formatVolume(workout.total_volume)}</span>
              </span>
            )}
            {workout.source && (
              <span className="text-[11px] font-mono uppercase tracking-wide text-gray-400 self-center">
                {workout.source}
              </span>
            )}
          </div>

          <div className="mt-6 space-y-6">
            {workout.exercises.length === 0 ? (
              <p className="text-[14px] text-[#9ca3af]">
                No exercise details logged for this workout.
              </p>
            ) : (
              workout.exercises.map((ex, exIdx) => (
                <div
                  key={`${ex.exerciseName}-${exIdx}`}
                  className="border border-gray-100 rounded-2xl p-4"
                >
                  <div className="flex items-baseline justify-between gap-3 mb-3">
                    <h3 className="text-[15px] font-bold text-gray-900">{ex.exerciseName}</h3>
                    {ex.muscleGroup && (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                        {ex.muscleGroup}
                      </span>
                    )}
                  </div>
                  {ex.sets.length === 0 ? (
                    <p className="text-[12px] text-[#9ca3af]">No sets logged.</p>
                  ) : (
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                          <th className="pb-2 w-16">Set</th>
                          <th className="pb-2">Weight</th>
                          <th className="pb-2">Reps</th>
                        </tr>
                      </thead>
                      <tbody className="text-[13px] font-mono">
                        {ex.sets.map((s, i) => (
                          <tr
                            key={`${s.setNumber}-${i}`}
                            className="border-t border-gray-50"
                          >
                            <td className="py-2 text-gray-400">{s.setNumber}</td>
                            <td className="py-2 font-bold text-gray-900">
                              {s.weight != null ? `${s.weight} kg` : "—"}
                            </td>
                            <td className="py-2 text-gray-700">
                              {s.reps != null ? s.reps : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ))
            )}
          </div>

          {workout.notes && (
            <p className="mt-6 text-[13px] text-gray-600 italic border-t border-gray-50 pt-4">
              {workout.notes}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function Sport() {
  const [metrics, setMetrics] = useState<BodyMetric[]>([]);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeWorkoutId, setActiveWorkoutId] = useState<number | null>(null);

  const [newWeightInput, setNewWeightInput] = useState("");
  const [weightSaving, setWeightSaving] = useState(false);
  const [weightError, setWeightError] = useState<string | null>(null);

  const [showAddWorkout, setShowAddWorkout] = useState(false);
  const [newWorkoutType, setNewWorkoutType] = useState<"strength" | "cardio">(
    "strength"
  );
  const [newWorkoutDuration, setNewWorkoutDuration] = useState("");
  const [newWorkoutNotes, setNewWorkoutNotes] = useState("");
  const [workoutSaving, setWorkoutSaving] = useState(false);
  const [workoutError, setWorkoutError] = useState<string | null>(null);

  const refetchWorkouts = useCallback(async () => {
    try {
      const list = await fetchWorkouts();
      setWorkouts(list);
    } catch (err) {
      console.error("[Sport] refetchWorkouts failed", err);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [m, w] = await Promise.allSettled([fetchBodyMetrics(), fetchWorkouts()]);
      if (cancelled) return;
      setMetrics(m.status === "fulfilled" ? m.value : []);
      setWorkouts(w.status === "fulfilled" ? w.value : []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const latestWeightEntry = latestBodyWeight(metrics);
  const latestHeightEntry = latestBodyHeight(metrics);
  const currentWeight = latestWeightEntry?.weight ?? null;
  const currentHeightCm = latestHeightEntry?.height ?? null;
  const bmi = bmiFromMetrics(metrics);

  // Last 8 weight measurements (ASC by date) for the trajectory chart
  const weightLogs = useMemo(() => {
    return [...metrics]
      .filter((m) => m.weight != null && (m.weight as number) > 0)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-8)
      .map((m) => ({
        rawDate: m.date,
        date: formatChartDate(m.date),
        weight: m.weight as number,
      }));
  }, [metrics]);

  const { trendDelta, trendSpanDays } = useMemo(() => {
    if (weightLogs.length < 2) return { trendDelta: 0, trendSpanDays: 0 };
    const first = weightLogs[0];
    const last = weightLogs[weightLogs.length - 1];
    const firstDate = parseIsoDate(first.rawDate);
    const lastDate = parseIsoDate(last.rawDate);
    const spanDays =
      firstDate && lastDate
        ? Math.max(
            1,
            Math.round((lastDate.getTime() - firstDate.getTime()) / 86_400_000)
          )
        : 0;
    return {
      trendDelta: Math.round((last.weight - first.weight) * 10) / 10,
      trendSpanDays: spanDays,
    };
  }, [weightLogs]);

  const trendLabel = useMemo(() => {
    if (weightLogs.length < 2) return "Trend: single data point";
    if (trendDelta < -0.5) return "Trend: cutting";
    if (trendDelta > 0.5) return "Trend: bulking";
    return "Trend: stable body mass";
  }, [trendDelta, weightLogs.length]);

  const chartBounds = useMemo(() => {
    if (weightLogs.length === 0) return { floor: 0, ceiling: 1 };
    const values = weightLogs.map((l) => l.weight);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const padding = Math.max(1, (max - min) * 0.2);
    return { floor: min - padding, ceiling: max + padding };
  }, [weightLogs]);

  const streakDays = useMemo(() => {
    if (workouts.length === 0) return 99;
    return daysSinceIso(workouts[0].date);
  }, [workouts]);

  const bmiInfo = bmi != null ? bmiCategoryLabel(bmi) : null;
  const bmiText = bmi != null ? bmi.toFixed(1) : "—";

  const handleLogWeight = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const parsed = parseFloat(newWeightInput);
      if (Number.isNaN(parsed) || parsed <= 30 || parsed >= 250) {
        setWeightError("Enter a weight between 30 and 250 kg");
        return;
      }

      setWeightError(null);
      setWeightSaving(true);
      try {
        const saved = await logBodyMetric({
          weight: parsed,
          date: todayIso(),
        });
        setMetrics((prev) => {
          const filtered = prev.filter((m) => m.id !== saved.id);
          return [saved, ...filtered];
        });
        setNewWeightInput("");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to save weight";
        setWeightError(msg);
      } finally {
        setWeightSaving(false);
      }
    },
    [newWeightInput]
  );

  const handleLogWorkout = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const duration = parseInt(newWorkoutDuration, 10);
      if (Number.isNaN(duration) || duration <= 0) {
        setWorkoutError("Duration must be a positive number of minutes");
        return;
      }

      setWorkoutError(null);
      setWorkoutSaving(true);
      try {
        await logWorkout({
          date: todayIso(),
          type: newWorkoutType,
          duration,
          notes: newWorkoutNotes.trim() || null,
          exercises: [],
        });
        await refetchWorkouts();
        setShowAddWorkout(false);
        setNewWorkoutDuration("");
        setNewWorkoutNotes("");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to save workout";
        setWorkoutError(msg);
      } finally {
        setWorkoutSaving(false);
      }
    },
    [newWorkoutDuration, newWorkoutNotes, newWorkoutType, refetchWorkouts]
  );

  const activeWorkout =
    activeWorkoutId != null
      ? workouts.find((w) => w.id === activeWorkoutId) ?? null
      : null;

  return (
    <div className="flex flex-col gap-6 pb-12 select-none font-sans">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-amber-50 text-amber-600 rounded-xl">
              <Dumbbell size={22} className="fill-amber-100" />
            </div>
            <div>
              <h1 className={t.pageTitle}>
                Athletic Command & Sport
              </h1>
              <p className={cn(t.pageSub, "mt-0.5")}>
                Physical Performance, Structural Weights & Session History
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-amber-50/50 border border-amber-100 px-3.5 py-1.5 rounded-xl">
          <Flame size={14} className="text-amber-600" />
          <span className="text-xs font-bold text-amber-700">Sport Performance Standard</span>
        </div>
      </div>

      {loading && (
        <div className="bg-white p-6 rounded-[20px] shadow-sm border border-gray-100">
          <p className="text-[14px] text-[#9ca3af]">Loading sport data…</p>
        </div>
      )}

      {!loading && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left + middle: metrics + history */}
          <div className="lg:col-span-2 space-y-6">
            {/* Bento metric cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Weight card */}
              <div className="bg-white p-6 rounded-[20px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] border border-gray-100 flex flex-col justify-between group transition-all relative">
                <div>
                  <div className="flex justify-between items-start mb-2">
                    <p className={t.cardLabel}>Weight</p>
                    <Scale size={16} className="text-rose-500" />
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className={t.hero}>
                      {currentWeight != null ? currentWeight : "—"}
                    </span>
                    <span className={t.heroSub}>kg</span>
                  </div>
                  <span className="text-[10px] text-gray-400 mt-1 block">{trendLabel}</span>
                </div>

                <form
                  onSubmit={handleLogWeight}
                  className="mt-4 pt-4 border-t border-gray-50 flex flex-col gap-1.5"
                >
                  <div className="flex gap-2">
                    <input
                      type="number"
                      step="0.1"
                      placeholder="New weight..."
                      value={newWeightInput}
                      onChange={(e) => setNewWeightInput(e.target.value)}
                      disabled={weightSaving}
                      className="flex-1 px-3 py-1.5 bg-gray-50 border border-gray-100 rounded-lg text-xs font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500/50 text-gray-800 disabled:opacity-50"
                    />
                    <button
                      type="submit"
                      disabled={weightSaving}
                      className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold px-3 py-1.5 rounded-lg text-[11px] uppercase tracking-wider transition-colors"
                    >
                      {weightSaving ? "…" : "Log"}
                    </button>
                  </div>
                  {weightError && (
                    <p className="text-[10px] text-rose-500 font-medium">{weightError}</p>
                  )}
                </form>
              </div>

              {/* Height card */}
              <div className="bg-white p-6 rounded-[20px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] border border-gray-100 flex flex-col justify-between transition-all">
                <div>
                  <div className="flex justify-between items-start mb-2">
                    <p className={t.cardLabel}>Height</p>
                    <Activity size={16} className="text-indigo-500" />
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className={t.hero}>
                      {currentHeightCm != null ? currentHeightCm : "—"}
                    </span>
                    <span className={t.heroSub}>cm</span>
                  </div>
                  <span className="text-[10px] text-gray-400 mt-1 block">Active biometric ceiling</span>
                </div>
                <div className="pt-4 border-t border-gray-50">
                  <span className="text-[10px] text-gray-400 uppercase font-black tracking-wider block">
                    Clinical Status
                  </span>
                  <span className="text-xs font-bold text-gray-700 mt-0.5 block">
                    Static Biological Baseline
                  </span>
                </div>
              </div>

              {/* BMI card */}
              <div className="bg-white p-6 rounded-[20px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] border border-gray-100 flex flex-col justify-between transition-all">
                <div>
                  <div className="flex justify-between items-start mb-2">
                    <p className={t.cardLabel}>
                      Calculated BMI
                    </p>
                    <Zap size={16} className="text-amber-500" />
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className={t.hero}>
                      {bmiText}
                    </span>
                    <span className={t.heroSub}>Index</span>
                  </div>
                  <span
                    className={cn(
                      "text-[10px] font-bold mt-1 block",
                      bmiInfo?.className ?? "text-gray-400"
                    )}
                  >
                    {bmiInfo?.label ?? "Status: not enough data"}
                  </span>
                </div>
                <div className="pt-4 border-t border-gray-50">
                  <span className="text-[10px] text-gray-400 uppercase font-black tracking-wider block">
                    Composition
                  </span>
                  <span className="text-xs font-bold text-gray-700 mt-0.5 block">
                    High Musculature Lean Index
                  </span>
                </div>
              </div>
            </div>

            {/* Weight Trajectory */}
            <div className="bg-white p-6 rounded-[20px] shadow-sm border border-gray-100">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="text-sm font-extrabold text-gray-900">Dry Weight Trajectory</h3>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    Last {weightLogs.length || 0} measurement{weightLogs.length === 1 ? "" : "s"} from body metrics.
                  </p>
                </div>

                {weightLogs.length >= 2 && (
                  <div className="flex items-center text-xs font-bold gap-1">
                    {trendDelta < 0 ? (
                      <>
                        <TrendingDown size={14} className="text-emerald-500" />
                        <span className="text-emerald-600 font-mono">
                          {trendDelta.toFixed(1)} kg ({trendSpanDays} day{trendSpanDays === 1 ? "" : "s"})
                        </span>
                      </>
                    ) : trendDelta > 0 ? (
                      <>
                        <TrendingUp size={14} className="text-rose-500" />
                        <span className="text-rose-500 font-mono">
                          +{trendDelta.toFixed(1)} kg ({trendSpanDays} day{trendSpanDays === 1 ? "" : "s"})
                        </span>
                      </>
                    ) : (
                      <span className="text-gray-400 font-mono">No change</span>
                    )}
                  </div>
                )}
              </div>

              {weightLogs.length === 0 ? (
                <p className="text-[13px] text-[#9ca3af] py-6 text-center">
                  No weight data yet — log via chat (e.g. «вес 95 кг») or the form above.
                </p>
              ) : (
                <div className="h-[120px] flex items-end gap-2.5 pt-6 pb-2 px-1 relative">
                  {weightLogs.map((log, index) => {
                    const range = chartBounds.ceiling - chartBounds.floor || 1;
                    const hPct = ((log.weight - chartBounds.floor) / range) * 90 + 10;
                    const cappedHt = Math.max(10, Math.min(100, hPct));
                    return (
                      <div
                        key={`${log.rawDate}-${index}`}
                        className="flex-1 flex flex-col items-center gap-2 group cursor-pointer relative"
                      >
                        <div className="absolute bottom-full mb-1 opacity-0 group-hover:opacity-100 bg-gray-900 text-white font-mono text-[9px] px-1.5 py-0.5 rounded transition-all duration-300 z-10 pointer-events-none">
                          {log.weight}kg
                        </div>
                        <div className="w-full bg-indigo-50/50 rounded-t-lg transition-all duration-300 h-[100px] flex items-end overflow-hidden border border-indigo-50/30 group-hover:border-indigo-100">
                          <motion.div
                            initial={{ height: 0 }}
                            animate={{ height: `${cappedHt}%` }}
                            transition={{ duration: 0.8, ease: "easeOut", delay: index * 0.05 }}
                            className="w-full bg-indigo-500 hover:bg-indigo-600 transition-colors rounded-t-lg"
                          />
                        </div>
                        <span className="font-mono text-[9px] text-gray-400">{log.date}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Workout history (read-only — workouts are imported from Coaich) */}
            <div className="bg-white p-6 rounded-[20px] shadow-sm border border-gray-100 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-[13px] font-black text-gray-900 uppercase tracking-wider flex items-center gap-1.5">
                    <History size={16} className="text-indigo-600" />
                    Gym Workout & Performance Logs
                  </h3>
                  <p className="text-[11px] text-gray-400 mt-1">
                    Coaich imports + manual sessions. Click a row for full set-by-set breakdown.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {workouts.length > 0 && (
                    <span className="text-[10px] font-mono text-gray-400 uppercase">
                      {workouts.length} session{workouts.length === 1 ? "" : "s"}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddWorkout((v) => !v);
                      setWorkoutError(null);
                    }}
                    className="flex items-center gap-1.5 text-xs text-indigo-600 font-bold bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-100 hover:bg-indigo-100/50 transition-colors"
                  >
                    {showAddWorkout ? <X size={14} /> : <Plus size={14} />}
                    {showAddWorkout ? "Close" : "Log Session"}
                  </button>
                </div>
              </div>

              <AnimatePresence>
                {showAddWorkout && (
                  <motion.form
                    onSubmit={handleLogWorkout}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="bg-gray-50 border border-gray-100 p-4 rounded-xl space-y-3 overflow-hidden text-xs"
                  >
                    <p className="font-bold text-gray-700">Add New Training Session</p>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                          Type
                        </span>
                        <select
                          value={newWorkoutType}
                          onChange={(e) =>
                            setNewWorkoutType(
                              e.target.value as "strength" | "cardio"
                            )
                          }
                          disabled={workoutSaving}
                          className="p-2 border border-gray-200 outline-none rounded bg-white text-gray-800 disabled:opacity-50"
                        >
                          <option value="strength">Strength / Weights</option>
                          <option value="cardio">Cardio / Zone 2</option>
                        </select>
                      </div>

                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                          Duration (min)
                        </span>
                        <input
                          type="number"
                          placeholder="e.g. 60"
                          required
                          min={1}
                          value={newWorkoutDuration}
                          onChange={(e) => setNewWorkoutDuration(e.target.value)}
                          disabled={workoutSaving}
                          className="p-2 border border-gray-200 outline-none rounded bg-white text-gray-800 disabled:opacity-50"
                        />
                      </div>

                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                          Notes / Lift logs
                        </span>
                        <input
                          type="text"
                          placeholder="e.g. Bench Press 80kg"
                          value={newWorkoutNotes}
                          onChange={(e) => setNewWorkoutNotes(e.target.value)}
                          disabled={workoutSaving}
                          className="p-2 border border-gray-200 outline-none rounded bg-white text-gray-800 disabled:opacity-50"
                        />
                      </div>
                    </div>

                    {workoutError && (
                      <p className="text-[11px] text-rose-500 font-medium">{workoutError}</p>
                    )}

                    <div className="flex justify-end pt-2">
                      <button
                        type="submit"
                        disabled={workoutSaving}
                        className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-extrabold px-4 py-2 rounded-lg leading-none"
                      >
                        {workoutSaving ? "Saving…" : "Save Session"}
                      </button>
                    </div>
                  </motion.form>
                )}
              </AnimatePresence>

              {workouts.length === 0 ? (
                <p className="text-[13px] text-[#9ca3af] py-4">
                  No workouts yet — log one above, or import a Coaich backup via{" "}
                  <span className="font-mono">python3 import_workouts.py coaich-backup.json</span>.
                </p>
              ) : (
                <div className="divide-y divide-gray-50 pt-2">
                  {workouts.map((w) => {
                    const isStrength = (w.type ?? "").toLowerCase() === "strength";
                    const topExercise =
                      w.exercises.length > 0 ? w.exercises[0].exerciseName : null;
                    const logText =
                      (w.notes && w.notes.trim()) ||
                      topExercise ||
                      formatWorkoutType(w.type);
                    const durationText =
                      w.duration != null ? `${w.duration} min` : "—";
                    const volumeText =
                      w.total_volume != null && w.total_volume > 0
                        ? ` • ${formatVolume(w.total_volume)}`
                        : "";
                    return (
                      <button
                        key={w.id}
                        type="button"
                        onClick={() => setActiveWorkoutId(w.id)}
                        className="w-full text-left py-3 flex justify-between items-center group hover:bg-gray-50/50 px-2 rounded-lg transition-all"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={cn(
                              "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shadow-sm",
                              isStrength
                                ? "bg-amber-50 text-amber-600"
                                : "bg-teal-50 text-teal-600"
                            )}
                          >
                            {isStrength ? <Dumbbell size={14} /> : <Activity size={14} />}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-gray-800 truncate">
                              {logText}
                            </p>
                            <span className="text-[10px] text-gray-400 font-mono mt-0.5 block">
                              {formatWorkoutType(w.type)} training • {durationText}
                              {volumeText}
                            </span>
                          </div>
                        </div>

                        <span className="font-mono text-[10px] text-gray-400 shrink-0 ml-3">
                          {formatChartDate(w.date)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right Column — Status deck + insights (hardcoded copy per spec) */}
          <div className="space-y-6">
            <div className="bg-[#1a1a2e] rounded-[20px] p-6 shadow-sm border border-slate-800 text-white relative">
              <StatusDot color={streakDays > 7 ? "#ef4444" : "#10b981"} />
              <div className="flex gap-3">
                <div className="shrink-0 w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center text-white shadow-md">
                  <Bell size={16} />
                </div>
                <div>
                  <h4 className="text-[11px] font-black tracking-widest text-[#9ca3af] uppercase">
                    AIR4 SPORT DECK
                  </h4>
                  <p className="text-[13px] leading-relaxed font-bold mt-2 text-indigo-100">
                    {workouts.length === 0
                      ? `"No imported sessions yet. Bring in a Coaich backup so I can spot streaks, fatigue, and progressive overload."`
                      : streakDays > 7
                        ? `"${streakDays} days since the last logged session. High levels of Testosterone conversions may increase adipose holding if left physically un-stimulated."`
                        : streakDays > 2
                          ? `"${streakDays} days off — short rest cycle. Keep dynamic cardiovascular zone-2 triggers consistent to push blood viscosity limits into normal ranges."`
                          : `"Recent session logged ${streakDays === 0 ? "today" : `${streakDays} day${streakDays === 1 ? "" : "s"} ago`}. Maintain rhythm — high mechanical load with hydration discipline."`}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white p-6 rounded-[20px] shadow-sm border border-gray-100">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-800 mb-4 flex items-center gap-1.5">
                <Clock size={14} className="text-[#6366f1]" />
                Temporal Training Coherence
              </h3>

              <div className="space-y-4">
                <div className="text-xs p-3.5 rounded-xl bg-gray-50 border border-gray-100">
                  <p className="font-bold text-gray-700">Testosterone Retention</p>
                  <p className="text-gray-400 mt-1 leading-relaxed">
                    Supraphysiological androgens require regular glycolytic mobilization. High mechanical loads trigger muscular structural density, helping prevent high body fluids.
                  </p>
                </div>

                <div className="text-xs p-3.5 rounded-xl bg-gray-50 border border-gray-100">
                  <p className="font-bold text-gray-700">Cardiovascular Viscosity</p>
                  <p className="text-gray-400 mt-1 leading-relaxed">
                    At 50.6% Hematocrit, blood viscosity is thick. High hydration (4.0L/day) and low-intensity aerobic zone-2 sessions (e.g. 40 minutes at 135 bpm) are therapeutic.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white p-6 rounded-[20px] shadow-sm border border-gray-100 text-center py-6 flex flex-col items-center justify-center">
              <Flame size={28} className="text-orange-500 mb-2 animate-bounce" />
              <h4 className="text-xs font-bold text-gray-800">Metabolic Status</h4>
              <p className="text-[11px] text-gray-400 mt-1 leading-relaxed max-w-[200px]">
                Daily caloric requirement is estimated at 2,850 kcal during training phases. Minimize comfort restaurant dining during sluggish projects.
              </p>
            </div>
          </div>
        </div>
      )}

      {activeWorkout && (
        <WorkoutDetailsModal
          workout={activeWorkout}
          onClose={() => setActiveWorkoutId(null)}
        />
      )}
    </div>
  );
}
