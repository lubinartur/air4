import { useEffect, useState } from "react";
import { Activity, Flame, X, Zap } from "lucide-react";
import {
  bmiFromMetrics,
  fetchBodyMetrics,
  fetchWorkouts,
  hasHealthData,
  latestBodyHeight,
  latestBodyWeight,
  type BodyMetric,
  type Workout,
} from "../lib/api";
import { formatWorkoutType } from "../lib/format";
import { PageEmptyState } from "./PageEmptyState";

function formatVolume(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)}t`;
  }
  return `${Math.round(value)} kg`;
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
          <h2 className="text-2xl font-black text-gray-900 tracking-tight mt-1">
            {formatWorkoutType(workout.type)}
          </h2>

          <div className="flex flex-wrap gap-x-6 gap-y-2 mt-4 text-[13px] text-gray-600">
            {workout.duration != null && (
              <span>
                <span className="text-gray-400">Duration:</span>{" "}
                <span className="font-bold text-gray-900">
                  {workout.duration} min
                </span>
              </span>
            )}
            {workout.total_volume != null && workout.total_volume > 0 && (
              <span>
                <span className="text-gray-400">Volume:</span>{" "}
                <span className="font-bold text-gray-900">
                  {formatVolume(workout.total_volume)}
                </span>
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
                    <h3 className="text-[15px] font-bold text-gray-900">
                      {ex.exerciseName}
                    </h3>
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

export function Health() {
  const [metrics, setMetrics] = useState<BodyMetric[]>([]);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeWorkoutId, setActiveWorkoutId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [metricsRes, workoutsRes] = await Promise.allSettled([
          fetchBodyMetrics(),
          fetchWorkouts(),
        ]);
        if (!cancelled) {
          setMetrics(metricsRes.status === "fulfilled" ? metricsRes.value : []);
          setWorkouts(workoutsRes.status === "fulfilled" ? workoutsRes.value : []);
        }
      } catch (err) {
        console.error("[AIR4 health] Health page unexpected error", err);
        if (!cancelled) {
          setMetrics([]);
          setWorkouts([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const latestWeight = latestBodyWeight(metrics);
  const latestHeight = latestBodyHeight(metrics);
  const bmi = bmiFromMetrics(metrics);
  const hasData = hasHealthData(metrics, workouts);

  const header = (
    <div>
      <h1 className="text-4xl font-black text-gray-900 tracking-tight">Health</h1>
      <p className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.2em] mt-1">
        Sport Advisor
      </p>
    </div>
  );

  if (loading) {
    return (
      <div className="flex flex-col gap-8 pb-10">
        {header}
        <p className="text-[14px] text-[#9ca3af]">Loading…</p>
      </div>
    );
  }

  if (!hasData) {
    return (
      <div className="flex flex-col gap-8 pb-10">
        {header}
        <PageEmptyState
          icon={Activity}
          title="No health data yet"
          subtext="Tell AIR4 your weight in chat (e.g. «вес 82 кг»), or log a workout in chat (e.g. «did bench 3x10 80kg»)."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 pb-10">
      {header}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
          <h2 className="text-[11px] font-bold text-[#9ca3af] uppercase tracking-[0.1em] mb-6">
            Body Metrics
          </h2>
          {latestWeight || latestHeight || bmi != null ? (
            <div className="grid grid-cols-2 gap-6">
              {latestWeight && (
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Weight</p>
                  <span className="font-mono text-3xl font-black text-gray-900">
                    {latestWeight.weight}
                  </span>
                  <span className="text-lg font-bold text-gray-400 ml-1">kg</span>
                  <p className="text-[11px] text-gray-400 mt-1">{latestWeight.date}</p>
                </div>
              )}
              {latestHeight && (
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Height</p>
                  <span className="font-mono text-3xl font-black text-gray-900">
                    {latestHeight.height}
                  </span>
                  <span className="text-lg font-bold text-gray-400 ml-1">cm</span>
                  <p className="text-[11px] text-gray-400 mt-1">{latestHeight.date}</p>
                </div>
              )}
              {bmi != null && latestWeight && latestHeight && (
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">BMI</p>
                  <span className="font-mono text-3xl font-black text-indigo-600">{bmi}</span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-[14px] text-[#9ca3af]">Tell AIR4 your weight in chat.</p>
          )}
        </div>

        <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
          <h2 className="text-[11px] font-bold text-[#9ca3af] uppercase tracking-[0.1em] mb-6">
            Workout History
          </h2>
          {workouts.length === 0 ? (
            <p className="text-[14px] text-[#9ca3af]">Log your workout in chat.</p>
          ) : (
            <div className="space-y-4">
              {workouts.map((w) => {
                const exerciseCount = w.exercises.length;
                const badge =
                  w.total_volume != null && w.total_volume > 0
                    ? formatVolume(w.total_volume)
                    : exerciseCount > 0
                      ? `${exerciseCount} ex`
                      : w.notes;
                return (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => setActiveWorkoutId(w.id)}
                    className="w-full flex items-center justify-between gap-4 p-4 bg-gray-50/30 rounded-2xl text-left transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-white border border-gray-100 flex items-center justify-center shrink-0">
                        {w.type === "cardio" ? (
                          <Zap size={18} className="text-blue-500" />
                        ) : (
                          <Flame size={18} className="text-orange-500" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[14px] font-bold text-gray-900">
                          {formatWorkoutType(w.type)}
                        </p>
                        <p className="text-[11px] text-gray-400 font-medium">
                          {w.date}
                          {w.duration != null ? ` · ${w.duration} min` : ""}
                        </p>
                      </div>
                    </div>
                    {badge && (
                      <span className="font-mono text-[11px] font-bold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full truncate max-w-[45%]">
                        {badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {activeWorkoutId != null &&
        (() => {
          const active = workouts.find((w) => w.id === activeWorkoutId);
          if (!active) return null;
          return (
            <WorkoutDetailsModal
              workout={active}
              onClose={() => setActiveWorkoutId(null)}
            />
          );
        })()}
    </div>
  );
}
