import { useEffect, useState } from "react";
import { Activity, Flame, Zap } from "lucide-react";
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

export function Health() {
  const [metrics, setMetrics] = useState<BodyMetric[]>([]);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [loading, setLoading] = useState(true);

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
              {workouts.map((w) => (
                <div
                  key={w.id}
                  className="flex items-center justify-between gap-4 p-4 bg-gray-50/30 rounded-2xl"
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
                      <p className="text-[11px] text-gray-400 font-medium">{w.date}</p>
                    </div>
                  </div>
                  {w.notes && (
                    <span className="font-mono text-[11px] font-bold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full truncate max-w-[45%]">
                      {w.notes}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
