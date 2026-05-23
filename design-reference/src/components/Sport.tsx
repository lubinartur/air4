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
  "янв", "фев", "мар", "апр", "май", "июн",
  "июл", "авг", "сен", "окт", "ноя", "дек",
];

function formatVolume(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)} т`;
  }
  return `${Math.round(value)} кг`;
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
  if (bmi < 18.5) return { label: "Статус: Недостаточный вес", className: "text-amber-500" };
  if (bmi < 25) return { label: "Статус: Норма", className: "text-emerald-600" };
  if (bmi < 30) return { label: "Статус: Избыточный вес", className: "text-rose-500" };
  return { label: "Статус: Ожирение", className: "text-rose-600" };
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
          aria-label="Закрыть"
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
                <span className="text-gray-400">Длительность:</span>{" "}
                <span className="font-bold text-gray-900">{workout.duration} мин</span>
              </span>
            )}
            {workout.total_volume != null && workout.total_volume > 0 && (
              <span>
                <span className="text-gray-400">Объём:</span>{" "}
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
                Детали упражнений по этой тренировке не записаны.
              </p>
            ) : (
              workout.exercises.map((ex) => (
                <div
                  key={ex.exerciseName}
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
                    <p className="text-[12px] text-[#9ca3af]">Подходы не записаны.</p>
                  ) : (
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                          <th className="pb-2 w-16">Подход</th>
                          <th className="pb-2">Вес</th>
                          <th className="pb-2">Повторы</th>
                        </tr>
                      </thead>
                      <tbody className="text-[13px] font-mono">
                        {ex.sets.map((s) => (
                          <tr
                            key={s.setNumber}
                            className="border-t border-gray-50"
                          >
                            <td className="py-2 text-gray-400">{s.setNumber}</td>
                            <td className="py-2 font-bold text-gray-900">
                              {s.weight != null ? `${s.weight} кг` : "—"}
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
    if (weightLogs.length < 2) return "Тренд: одна точка данных";
    if (trendDelta < -0.5) return "Тренд: сушка";
    if (trendDelta > 0.5) return "Тренд: набор массы";
    return "Тренд: стабильный вес";
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
        setWeightError("Введите вес от 30 до 250 кг");
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
        const msg = err instanceof Error ? err.message : "Не удалось сохранить вес";
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
        setWorkoutError("Длительность должна быть положительным числом минут");
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
        const msg = err instanceof Error ? err.message : "Не удалось сохранить тренировку";
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
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-amber-50 text-amber-600 rounded-xl">
              <Dumbbell size={22} className="fill-amber-100" />
            </div>
            <div>
              <h1 className={t.pageTitle}>
                Спорт и тренировки
              </h1>
              <p className={cn(t.pageSub, "mt-0.5")}>
                Физическая форма, рабочие веса и история тренировок
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-amber-50/50 border border-amber-100 px-3.5 py-1.5 rounded-xl">
          <Flame size={14} className="text-amber-600" />
          <span className="text-xs font-bold text-amber-700">Спортивный советник</span>
        </div>
      </div>

      {loading && (
        <div className="bg-white p-6 rounded-[20px] shadow-sm border border-gray-100">
          <p className="text-[14px] text-[#9ca3af]">Загрузка спортивных данных…</p>
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
                    <p className={t.cardLabel}>Вес</p>
                    <Scale size={16} className="text-rose-500" />
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className={t.hero}>
                      {currentWeight != null ? currentWeight : "—"}
                    </span>
                    <span className={t.heroSub}>кг</span>
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
                      placeholder="Новый вес..."
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
                      {weightSaving ? "…" : "Записать"}
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
                    <p className={t.cardLabel}>Рост</p>
                    <Activity size={16} className="text-indigo-500" />
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className={t.hero}>
                      {currentHeightCm != null ? currentHeightCm : "—"}
                    </span>
                    <span className={t.heroSub}>см</span>
                  </div>
                  <span className="text-[10px] text-gray-400 mt-1 block">Активный биометрический верхний предел</span>
                </div>
                <div className="pt-4 border-t border-gray-50">
                  <span className="text-[10px] text-gray-400 uppercase font-black tracking-wider block">
                    Клинический статус
                  </span>
                  <span className="text-xs font-bold text-gray-700 mt-0.5 block">
                    Стабильная биологическая база
                  </span>
                </div>
              </div>

              {/* BMI card */}
              <div className="bg-white p-6 rounded-[20px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] border border-gray-100 flex flex-col justify-between transition-all">
                <div>
                  <div className="flex justify-between items-start mb-2">
                    <p className={t.cardLabel}>
                      Расчётный ИМТ
                    </p>
                    <Zap size={16} className="text-amber-500" />
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className={t.hero}>
                      {bmiText}
                    </span>
                    <span className={t.heroSub}>индекс</span>
                  </div>
                  <span
                    className={cn(
                      "text-[10px] font-bold mt-1 block",
                      bmiInfo?.className ?? "text-gray-400"
                    )}
                  >
                    {bmiInfo?.label ?? "Статус: недостаточно данных"}
                  </span>
                </div>
                <div className="pt-4 border-t border-gray-50">
                  <span className="text-[10px] text-gray-400 uppercase font-black tracking-wider block">
                    Состав тела
                  </span>
                  <span className="text-xs font-bold text-gray-700 mt-0.5 block">
                    Высокий показатель сухой мышечной массы
                  </span>
                </div>
              </div>
            </div>

            {/* Weight Trajectory */}
            <div className="bg-white p-6 rounded-[20px] shadow-sm border border-gray-100">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="text-lg font-extrabold text-gray-900">Динамика веса</h3>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    Последние {weightLogs.length || 0}{" "}
                    {weightLogs.length % 10 === 1 && weightLogs.length % 100 !== 11
                      ? "измерение"
                      : weightLogs.length % 10 >= 2 && weightLogs.length % 10 <= 4 && (weightLogs.length % 100 < 12 || weightLogs.length % 100 > 14)
                      ? "измерения"
                      : "измерений"} из биометрии.
                  </p>
                </div>

                {weightLogs.length >= 2 && (
                  <div className="flex items-center text-xs font-bold gap-1">
                    {trendDelta < 0 ? (
                      <>
                        <TrendingDown size={14} className="text-emerald-500" />
                        <span className="text-emerald-600 font-mono">
                          {trendDelta.toFixed(1)} кг ({trendSpanDays} дн)
                        </span>
                      </>
                    ) : trendDelta > 0 ? (
                      <>
                        <TrendingUp size={14} className="text-rose-500" />
                        <span className="text-rose-500 font-mono">
                          +{trendDelta.toFixed(1)} кг ({trendSpanDays} дн)
                        </span>
                      </>
                    ) : (
                      <span className="text-gray-400 font-mono">Без изменений</span>
                    )}
                  </div>
                )}
              </div>

              {weightLogs.length === 0 ? (
                <p className="text-[13px] text-[#9ca3af] py-6 text-center">
                  Данных о весе пока нет — запишите через чат (например, «вес 95 кг») или через форму выше.
                </p>
              ) : (
                <div className="h-[120px] flex items-end gap-2.5 pt-6 pb-2 px-1 relative">
                  {weightLogs.map((log, index) => {
                    const range = chartBounds.ceiling - chartBounds.floor || 1;
                    const hPct = ((log.weight - chartBounds.floor) / range) * 90 + 10;
                    const cappedHt = Math.max(10, Math.min(100, hPct));
                    return (
                      <div
                        key={log.rawDate}
                        className="flex-1 flex flex-col items-center gap-2 group cursor-pointer relative"
                      >
                        <div className="absolute bottom-full mb-1 opacity-0 group-hover:opacity-100 bg-gray-900 text-white font-mono text-[9px] px-1.5 py-0.5 rounded transition-all duration-300 z-10 pointer-events-none">
                          {log.weight} кг
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
                  <h3 className="text-lg font-extrabold text-gray-900 flex items-center gap-2">
                    <History size={18} className="text-indigo-600" />
                    Журнал тренировок
                  </h3>
                  <p className="text-[11px] text-gray-400 mt-1">
                    Импорт из Coaich + ручные сессии. Кликните по строке для разбора по подходам.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {workouts.length > 0 && (
                    <span className="text-[10px] font-mono text-gray-400 uppercase">
                      {workouts.length}{" "}
                      {workouts.length % 10 === 1 && workouts.length % 100 !== 11
                        ? "сессия"
                        : workouts.length % 10 >= 2 && workouts.length % 10 <= 4 && (workouts.length % 100 < 12 || workouts.length % 100 > 14)
                        ? "сессии"
                        : "сессий"}
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
                    {showAddWorkout ? "Закрыть" : "Записать сессию"}
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
                    <p className="font-bold text-gray-700">Добавить тренировку</p>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                          Тип
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
                          <option value="strength">Силовая / Веса</option>
                          <option value="cardio">Кардио / Зона 2</option>
                        </select>
                      </div>

                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                          Длительность (мин)
                        </span>
                        <input
                          type="number"
                          placeholder="например, 60"
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
                          Заметки / упражнения
                        </span>
                        <input
                          type="text"
                          placeholder="например, жим лёжа 80 кг"
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
                        {workoutSaving ? "Сохранение…" : "Сохранить сессию"}
                      </button>
                    </div>
                  </motion.form>
                )}
              </AnimatePresence>

              {workouts.length === 0 ? (
                <p className="text-[13px] text-[#9ca3af] py-4">
                  Тренировок пока нет — добавьте через форму выше или импортируйте бэкап Coaich:{" "}
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
                    const hasVolume =
                      w.total_volume != null && w.total_volume > 0;
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
                            {/* Meta line — type label stays in Inter
                                (Cyrillic), but the numeric segments
                                (duration, volume) get `font-mono` so
                                their digits align in JetBrains Mono and
                                read as data, not prose. */}
                            <span className="text-[10px] text-gray-400 mt-0.5 block">
                              {formatWorkoutType(w.type)}
                              {" • "}
                              <span className="font-mono">
                                {w.duration != null
                                  ? `${w.duration} мин`
                                  : "—"}
                              </span>
                              {hasVolume && (
                                <>
                                  {" • "}
                                  <span className="font-mono">
                                    {formatVolume(w.total_volume as number)}
                                  </span>
                                </>
                              )}
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

          {/* Right Column — AIR4 advisor + status cards. AIR4 block
              uses the unified indigo variant shared across Sport,
              Projects, Goals, Finance, Health — same shape, same
              chrome, page-specific copy + decorative icon. Mirrors
              the Overview AIR4 Advisor card visual language in a
              more compact (p-5, text-[14px]) right-column form. */}
          <div className="space-y-6">
            <div className="relative overflow-hidden bg-[#4F46E5] rounded-2xl p-5 shadow-xl">
              <Dumbbell
                size={100}
                strokeWidth={1.5}
                className="absolute -top-3 -right-3 text-white/10 pointer-events-none"
              />
              <div className="relative space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    aria-hidden="true"
                    className="w-2 h-2 rounded-full bg-green-400 animate-pulse"
                  />
                  <span className="text-[11px] font-black text-white/80 uppercase tracking-widest">
                    AIR4 ADVISOR
                  </span>
                  <span className="bg-white/20 text-white text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full">
                    Спорт
                  </span>
                </div>
                <p className="text-[14px] font-medium text-white leading-relaxed pr-12">
                  {workouts.length === 0
                    ? `«Импортированных сессий пока нет. Импортируйте бэкап Coaich — я смогу отслеживать серии, усталость и прогрессию.»`
                    : streakDays > 7
                      ? `«${streakDays} дн с последней тренировки. Высокий уровень андрогенов без физического стимула может усиливать накопление жира.»`
                      : streakDays > 2
                        ? `«${streakDays} дн перерыва — короткий цикл отдыха. Держите кардио в зоне 2 регулярным, чтобы вязкость крови оставалась в норме.»`
                        : `«Последняя сессия записана ${streakDays === 0 ? "сегодня" : `${streakDays} дн назад`}. Держите ритм — высокая механическая нагрузка плюс дисциплина гидратации.»`}
                </p>
              </div>
            </div>

            <div className="bg-white p-6 rounded-[20px] shadow-sm border border-gray-100">
              {/* Card title matches Finance card-title family.
                  Clock icon retained as the visual hook for this
                  card's "timing/consistency" theme. */}
              <h3 className="text-lg font-extrabold text-gray-900 mb-4 flex items-center gap-2">
                <Clock size={18} className="text-[#6366f1]" />
                Согласованность тренировок
              </h3>

              {/* Sub-items: title at text-[13px] semibold gray-800,
                  body at text-[12px] gray-600. The outer `text-xs`
                  was removed so each child sets its own size and the
                  hierarchy doesn't collapse to 12px everywhere. */}
              <div className="space-y-4">
                <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-100">
                  <p className="text-[13px] font-semibold text-gray-800">
                    Удержание тестостерона
                  </p>
                  <p className="text-[12px] text-gray-600 mt-1 leading-relaxed">
                    Супрафизиологические андрогены требуют регулярной гликолитической нагрузки. Высокие механические веса повышают плотность мышц и помогают избегать задержки жидкости.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-100">
                  <p className="text-[13px] font-semibold text-gray-800">
                    Вязкость крови
                  </p>
                  <p className="text-[12px] text-gray-600 mt-1 leading-relaxed">
                    При гематокрите 50,6% вязкость крови высокая. Гидратация (4 л/день) и аэробные сессии в зоне 2 (например, 40 минут при 135 уд/мин) — терапевтичны.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white p-6 rounded-[20px] shadow-sm border border-gray-100">
              {/* Left-aligned to match the «Согласованность» card
                  above. The Flame icon is inline before the title
                  (same inline-icon pattern as other right-column
                  card titles) instead of floating above a centered
                  block. */}
              <h4 className="text-lg font-extrabold text-gray-900 mb-2 flex items-center gap-2">
                <Flame size={18} className="text-orange-500" />
                Метаболический статус
              </h4>
              <p className="text-[12px] text-gray-600 leading-relaxed">
                Суточная норма калорий в тренировочной фазе — около 2850 ккал. Минимизируйте «утешительные» походы в рестораны в периоды застрявших проектов.
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
