import { useEffect, useMemo, useState } from "react";
import {
  fetchProfile,
  fetchRecommendation,
  hasFinanceData,
  type BodyMetric,
  type CrossSphereInsight,
  type Dilemma,
  type Observation,
  type Project,
  type Recommendation,
  type Summary,
  type UserFact,
  type Workout,
} from "../lib/api";
import { daysSince } from "../lib/format";
import { Page } from "../types";

// The Props shape is kept identical to what App.tsx passes so the
// redesign is a drop-in replacement. Only a subset is used by the new
// dark layout; the rest stays in the type for compatibility.
type Props = {
  summary: Summary | null;
  projects: Project[];
  observations: Observation[];
  crossSphereInsights?: CrossSphereInsight[];
  insight: Observation | null;
  bodyMetrics: BodyMetric[];
  workouts: Workout[];
  loading: boolean;
  openDilemma: Dilemma | null;
  pendingFollowups: Dilemma[];
  activeProjects: Project[];
  onPageChange: (page: Page) => void;
  onOpenChatWithMessage: (text: string) => void;
};

// --- Design tokens -------------------------------------------------------
const C = {
  bg: "#1a1a2e",
  card: "#13131f",
  border: "rgba(255,255,255,0.05)",
  primary: "#f1f5f9",
  secondary: "#94a3b8",
  label: "#64748b",
  orange: "#f97316",
  green: "#22c55e",
  yellow: "#eab308",
  red: "#ef4444",
  gray: "#6b7280",
};

const LABEL_CLASS =
  "text-[11px] uppercase tracking-[0.08em] text-[#64748b] font-semibold";

type SphereStatus = "stable" | "attention" | "critical" | "neutral";

const STATUS_DOT: Record<SphereStatus, string> = {
  stable: C.green,
  attention: C.yellow,
  critical: C.red,
  neutral: C.gray,
};

// --- Status derivations (mirror the previous Overview logic) -------------
function financeStatus(summary: Summary | null): SphereStatus {
  if (!summary || !hasFinanceData(summary)) return "neutral";
  const income =
    (summary.total_income ?? 0) + (summary.other_incoming?.amount ?? 0);
  if (income <= 0) return "neutral";
  const free = income - (summary.total_spent ?? 0);
  if (free > 0) return "stable";
  if (free === 0) return "attention";
  return "critical";
}

function healthStatus(daysSinceWorkout: number | null): SphereStatus {
  if (daysSinceWorkout == null) return "neutral";
  if (daysSinceWorkout > 7) return "critical";
  if (daysSinceWorkout >= 4) return "attention";
  return "stable";
}

function projectsStatus(stalled: number, active: number): SphereStatus {
  if (active === 0) return "neutral";
  if (stalled >= active) return "critical";
  if (stalled > 1) return "attention";
  return "stable";
}

function memoryStatus(factCount: number): SphereStatus {
  if (factCount === 0) return "neutral";
  if (factCount >= 8) return "stable";
  return "attention";
}

// Open-loop tone by age in days: >14 red, >7 orange, else yellow.
function loopTone(days: number): { dot: string; badge: string } {
  if (days > 14)
    return { dot: C.red, badge: "bg-red-500/15 text-red-400" };
  if (days > 7)
    return { dot: C.orange, badge: "bg-orange-500/15 text-orange-400" };
  return { dot: C.yellow, badge: "bg-yellow-500/15 text-yellow-400" };
}

// Momentum bar color: >60 green, 30..60 orange, <30 red.
function barColor(pct: number): string {
  if (pct > 60) return C.green;
  if (pct >= 30) return C.orange;
  return C.red;
}

function projectMomentum(updatedAt: string | null | undefined): number {
  const days = updatedAt ? daysSince(updatedAt) : 999;
  if (days >= 14) return 15;
  if (days >= 7) return 30;
  if (days >= 3) return 55;
  return Math.max(60, 95 - days * 8);
}

function factEmoji(key: string, value: string): string {
  const s = `${key} ${value}`.toLowerCase();
  if (/ducati|moto|bike|байк|мотоц/.test(s)) return "🏍️";
  if (/tesla|car|авто|машин/.test(s)) return "🚗";
  if (/project|проект|air4|\bos\b|код|dev|програм/.test(s)) return "💻";
  if (/gym|workout|train|трен|sport|спорт|fit|сил/.test(s)) return "🏋️";
  if (/food|diet|eat|пит|еда|готов/.test(s)) return "🍳";
  if (/family|wife|husband|жен|муж|семь|partner|alisa|алиса|дет/.test(s))
    return "👨‍👩‍👧";
  if (/money|finance|фин|invest|salary|зарплат|доход/.test(s)) return "💰";
  if (/goal|цель|план|ambition/.test(s)) return "🎯";
  if (/travel|путеш|trip/.test(s)) return "✈️";
  if (/music|музык/.test(s)) return "🎵";
  if (/work|job|карьер|работ/.test(s)) return "💼";
  return "🧠";
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function pluralThings(n: number): string {
  const last = n % 10;
  const teen = n % 100;
  if (last === 1 && teen !== 11) return "вещь требует";
  if (last >= 2 && last <= 4 && (teen < 12 || teen > 14))
    return "вещи требуют";
  return "вещей требуют";
}

export function OverviewDashboard({
  summary,
  projects,
  observations,
  workouts,
  onPageChange,
  onOpenChatWithMessage,
}: Props) {
  // --- Self-contained async data (Promise.allSettled, never throws) ---
  const [recommendation, setRecommendation] = useState<Recommendation | null>(
    null,
  );
  const [recoLoading, setRecoLoading] = useState(true);
  const [name, setName] = useState<string | null>(null);
  const [facts, setFacts] = useState<UserFact[]>([]);
  const [factsLoading, setFactsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setRecoLoading(true);
    setFactsLoading(true);

    void Promise.allSettled([fetchRecommendation(), fetchProfile()]).then(
      ([recoRes, profileRes]) => {
        if (cancelled) return;
        if (recoRes.status === "fulfilled") setRecommendation(recoRes.value);
        else setRecommendation(null);
        if (profileRes.status === "fulfilled") {
          setName(profileRes.value.profile?.name ?? null);
          setFacts(profileRes.value.facts ?? []);
        }
        setRecoLoading(false);
        setFactsLoading(false);
      },
    );

    return () => {
      cancelled = true;
    };
  }, []);

  // --- Derived data ---
  const activeProjects = useMemo(
    () => projects.filter((p) => p.status === "active"),
    [projects],
  );
  const stalledCount = useMemo(
    () =>
      activeProjects.filter((p) => daysSince(p.updated_at) > 7).length,
    [activeProjects],
  );

  const latestWorkoutDate = workouts[0]?.date ?? null;
  const daysSinceWorkout = latestWorkoutDate
    ? daysSince(latestWorkoutDate)
    : null;

  const openLoops = useMemo(
    () => observations.filter((o) => !o.is_read).slice(0, 3),
    [observations],
  );

  const momentumProjects = useMemo(() => {
    return [...activeProjects]
      .sort((a, b) => daysSince(a.updated_at) - daysSince(b.updated_at))
      .slice(0, 4)
      .map((p) => ({
        id: p.id,
        name: p.name,
        pct: projectMomentum(p.updated_at),
      }));
  }, [activeProjects]);

  const weekWorkouts = useMemo(
    () => workouts.filter((w) => daysSince(w.date) <= 7).length,
    [workouts],
  );
  const trainingPct = Math.min(100, Math.round((weekWorkouts / 4) * 100));

  const topFacts = facts.slice(0, 5);

  const spheres: { label: string; status: SphereStatus; pos: string }[] = [
    {
      label: "Финансы",
      status: financeStatus(summary),
      pos: "top-3 left-1/2 -translate-x-1/2",
    },
    {
      label: "Память",
      status: memoryStatus(facts.length),
      pos: "top-1/2 left-3 -translate-y-1/2",
    },
    {
      label: "Здоровье",
      status: healthStatus(daysSinceWorkout),
      pos: "top-1/2 right-3 -translate-y-1/2",
    },
    {
      label: "Проекты",
      status: projectsStatus(stalledCount, activeProjects.length),
      pos: "bottom-3 left-1/2 -translate-x-1/2",
    },
  ];

  // --- Greeting / date line ---
  const now = new Date();
  const weekday = capitalize(
    now.toLocaleDateString("ru-RU", { weekday: "long" }),
  );
  const dayMonth = now.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
  });
  const attention = openLoops.length;
  const dateLine =
    attention > 0
      ? `${weekday} · ${dayMonth} · ${attention} ${pluralThings(attention)} внимания`
      : `${weekday} · ${dayMonth} · всё под контролем`;

  const cardStyle = {
    backgroundColor: C.card,
    border: `1px solid ${C.border}`,
  };

  return (
    <div
      className="-mx-8 -mt-8 px-6 pt-6 pb-0 min-h-full font-sans"
      style={{ backgroundColor: C.bg, color: C.primary }}
    >
      <style>{`
        @keyframes air4-morph {
          0%, 100% { border-radius: 60% 40% 30% 70% / 60% 30% 70% 40%; }
          50% { border-radius: 30% 60% 70% 40% / 50% 60% 30% 60%; }
        }
        @keyframes air4-float {
          0%, 100% { transform: translateY(-8px); }
          50% { transform: translateY(8px); }
        }
        @keyframes air4-glow {
          0%, 100% { box-shadow: 0 0 40px rgba(96,165,250,0.4); }
          50% { box-shadow: 0 0 60px rgba(96,165,250,0.7); }
        }
      `}</style>

      {/* ---------- Header ---------- */}
      <div className="mb-6">
        <h1 className="text-[28px] font-semibold leading-tight">
          Доброе утро{name ? `, ${name}` : ""}
        </h1>
        <p className="text-[13px] mt-1" style={{ color: C.secondary }}>
          {dateLine}
        </p>
      </div>

      {/* ---------- Row 1: Hero (60%) + Status (40%) ---------- */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 mb-5">
        {/* AIRCH INTELLIGENCE hero */}
        <div
          className="lg:col-span-3 rounded-2xl p-7 flex flex-col justify-between min-h-[230px]"
          style={{
            background: "linear-gradient(135deg, #1a0a00 0%, #0f0f14 100%)",
          }}
        >
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: C.orange }}
              />
              <span
                className="text-[11px] uppercase tracking-[0.08em] font-semibold"
                style={{ color: C.orange }}
              >
                AIRCH Intelligence
              </span>
            </div>

            {recoLoading ? (
              <div className="space-y-3 animate-pulse">
                <div className="h-5 w-4/5 rounded bg-white/10" />
                <div className="h-5 w-2/3 rounded bg-white/10" />
                <div className="h-3 w-1/2 rounded bg-white/5 mt-4" />
              </div>
            ) : recommendation ? (
              <>
                <p className="text-[22px] font-semibold leading-snug text-white">
                  {recommendation.recommendation}
                </p>
                {recommendation.basis && (
                  <p className="text-[13px]" style={{ color: C.secondary }}>
                    {recommendation.basis}
                  </p>
                )}
              </>
            ) : (
              <p className="text-[15px]" style={{ color: C.secondary }}>
                AIR4 пока собирает контекст. Загрузите данные или начните
                диалог в чате.
              </p>
            )}
          </div>

          {recommendation && !recoLoading && (
            <button
              type="button"
              onClick={() =>
                onOpenChatWithMessage(
                  "Разверни план по этой рекомендации — что делать по шагам?",
                )
              }
              className="mt-6 self-start rounded-[10px] px-5 py-2.5 text-[13px] font-semibold transition-colors hover:bg-[#f97316]/10"
              style={{
                border: `1.5px solid ${C.orange}`,
                color: C.orange,
                background: "transparent",
              }}
            >
              Открыть план →
            </button>
          )}
        </div>

        {/* STATUS sphere */}
        <div
          className="lg:col-span-2 rounded-2xl p-6 flex flex-col min-h-[230px]"
          style={cardStyle}
        >
          <span className={LABEL_CLASS}>Status</span>
          <div className="relative flex-1 mt-2 min-h-[170px]">
            {/* Animated sphere — outer wrapper centers it so the float
                keyframe (transform: translateY) doesn't fight the
                centering transform. */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
              <div
                style={{
                  width: 120,
                  height: 120,
                  borderRadius: "60% 40% 30% 70% / 60% 30% 70% 40%",
                  background:
                    "radial-gradient(circle at 30% 30%, #60a5fa, #34d399 50%, #818cf8)",
                  boxShadow: "0 0 40px rgba(96,165,250,0.4)",
                  animation:
                    "air4-morph 6s ease-in-out infinite, air4-float 3s ease-in-out infinite, air4-glow 3s ease-in-out infinite",
                }}
              />
            </div>
            {/* Sphere labels */}
            {spheres.map((s) => (
              <div
                key={s.label}
                className={`absolute ${s.pos} flex items-center gap-1.5`}
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: STATUS_DOT[s.status] }}
                />
                <span className="text-[12px]" style={{ color: C.secondary }}>
                  {s.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ---------- Row 2: Open Loops / Momentum / Memory ---------- */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* OPEN LOOPS */}
        <div className="rounded-2xl p-6" style={cardStyle}>
          <div className="flex items-center justify-between mb-4">
            <span className={LABEL_CLASS}>Open Loops</span>
            {openLoops.length > 0 && (
              <span
                className="text-[12px] font-semibold"
                style={{ color: C.orange }}
              >
                {openLoops.length} открыто
              </span>
            )}
          </div>
          <p className="text-[13px] mb-4" style={{ color: C.secondary }}>
            Что не закрыто
          </p>

          {openLoops.length === 0 ? (
            <div
              className="text-[14px] py-6 text-center"
              style={{ color: C.secondary }}
            >
              Всё под контролем 🟢
            </div>
          ) : (
            <div className="space-y-3">
              {openLoops.map((o) => {
                const days = o.created_at ? daysSince(o.created_at) : 0;
                const tone = loopTone(days);
                return (
                  <div key={o.id} className="flex items-start gap-3">
                    <span
                      className="w-2 h-2 rounded-full mt-1.5 shrink-0"
                      style={{ backgroundColor: tone.dot }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-[#f1f5f9] leading-snug">
                        {o.title}
                      </p>
                      {o.body && (
                        <p
                          className="text-[12px] leading-snug mt-0.5 line-clamp-1"
                          style={{ color: C.secondary }}
                        >
                          {o.body}
                        </p>
                      )}
                    </div>
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${tone.badge}`}
                    >
                      {days}д
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* MOMENTUM */}
        <div className="rounded-2xl p-6" style={cardStyle}>
          <span className={LABEL_CLASS}>Momentum</span>
          <p className="text-[13px] mt-1 mb-4" style={{ color: C.secondary }}>
            Что двигается
          </p>

          {momentumProjects.length === 0 && weekWorkouts === 0 ? (
            <div
              className="text-[14px] py-6 text-center"
              style={{ color: C.secondary }}
            >
              Нет активных проектов
            </div>
          ) : (
            <div className="space-y-4">
              {momentumProjects.map((p) => (
                <MomentumRow key={p.id} label={p.name} pct={p.pct} />
              ))}
              <MomentumRow label="Тренировки" pct={trainingPct} />
            </div>
          )}
        </div>

        {/* AIRCH MEMORY */}
        <div className="rounded-2xl p-6" style={cardStyle}>
          <div className="flex items-center justify-between mb-1">
            <span className={LABEL_CLASS}>AIRCH Memory</span>
            <button
              type="button"
              onClick={() => onPageChange("Memory")}
              className="text-[12px] font-semibold transition-opacity hover:opacity-80"
              style={{ color: C.orange }}
            >
              View all →
            </button>
          </div>
          <p className="text-[13px] mb-4" style={{ color: C.secondary }}>
            Что AIR4 помнит
          </p>

          {factsLoading ? (
            <div className="space-y-3 animate-pulse">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-4 w-full rounded bg-white/5" />
              ))}
            </div>
          ) : topFacts.length === 0 ? (
            <div
              className="text-[14px] py-6 text-center"
              style={{ color: C.secondary }}
            >
              AIR4 ещё не зафиксировал факты
            </div>
          ) : (
            <div className="space-y-3">
              {topFacts.map((f) => (
                <div key={f.key} className="flex items-start gap-2.5">
                  <span className="text-[15px] leading-none mt-0.5 shrink-0">
                    {factEmoji(f.key, f.value)}
                  </span>
                  <p className="text-[13px] leading-snug text-[#cbd5e1] line-clamp-2">
                    {f.value}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Single project/metric momentum row: label + bar + percent.
function MomentumRow({ label, pct }: { label: string; pct: number }) {
  const color = barColor(pct);
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[13px] font-medium text-[#e2e8f0] truncate pr-2">
          {label}
        </span>
        <span className="text-[12px] font-semibold" style={{ color }}>
          {pct}%
        </span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden bg-white/8">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}
