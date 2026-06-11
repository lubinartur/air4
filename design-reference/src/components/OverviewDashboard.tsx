import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  Brain,
  Briefcase,
  ChevronRight,
  Heart,
  LayoutDashboard,
  Scale,
  Sparkles,
  Wallet,
} from "lucide-react";
import {
  bmiFromMetrics,
  fetchRecommendation,
  formatCategoryLabel,
  formatEuro,
  hasFinanceData,
  latestBodyWeight,
  type BodyMetric,
  type CrossSphere,
  type CrossSphereInsight,
  type Dilemma,
  type Observation,
  type Project,
  type Recommendation,
  type RecommendationState,
  type Summary,
  type Workout,
} from "../lib/api";
import { daysSince, formatRelativeActivity } from "../lib/format";
import { cn } from "../lib/utils";
import { t } from "../lib/typography";
import { Page } from "../types";
import { AIRCheckIn } from "./AIRCheckIn";
import { LiveFeed } from "./LiveFeed";
import { OverviewCardEmpty } from "./OverviewCardEmpty";

type Props = {
  summary: Summary | null;
  projects: Project[];
  observations: Observation[];
  /** Cross-sphere insights served by /api/cross-sphere. Rendered at
   *  the top of the Patterns card so the cross-sphere correlations
   *  outrank the single-domain LLM observations below them. */
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

/** Two-tone palette per sphere — kept in one place so any future
 *  sphere addition only touches this map. Unknown spheres fall
 *  back to the neutral gray entry. */
const SPHERE_BADGE: Record<CrossSphere | "default", {
  label: string;
  className: string;
}> = {
  finance: {
    label: "ФИНАНСЫ",
    className: "bg-emerald-50 text-emerald-700 border-emerald-100",
  },
  health: {
    label: "ЗДОРОВЬЕ",
    className: "bg-rose-50 text-rose-700 border-rose-100",
  },
  projects: {
    label: "ПРОЕКТЫ",
    className: "bg-indigo-50 text-indigo-700 border-indigo-100",
  },
  life: {
    label: "ЖИЗНЬ",
    className: "bg-amber-50 text-amber-700 border-amber-100",
  },
  default: {
    label: "—",
    className: "bg-gray-50 text-gray-500 border-gray-100",
  },
};

function sphereBadge(sphere: string) {
  const key = (sphere || "").toLowerCase() as CrossSphere;
  return SPHERE_BADGE[key] ?? SPHERE_BADGE.default;
}

/** Confidence tone — matches the three-tier system the backend uses
 *  for the description prefix. Renders as a subtle right-aligned
 *  indicator so the user sees signal strength without it dominating
 *  the row. */
function confidenceTier(confidence: number): {
  label: string;
  dotClass: string;
} {
  if (confidence < 0.6) {
    return { label: "слабый сигнал", dotClass: "bg-gray-300" };
  }
  if (confidence < 0.8) {
    return { label: "паттерн", dotClass: "bg-amber-400" };
  }
  return { label: "уверенно", dotClass: "bg-emerald-500" };
}

const CATEGORY_COLORS = ["bg-red-500", "bg-green-500", "bg-orange-500", "bg-blue-500"];

// API persists project / dilemma status as English enum keys; map to
// Russian for display while keeping the raw value in props for logic.
const PROJECT_STATUS_LABEL: Record<string, string> = {
  active: "АКТИВЕН",
  stalled: "ЗАСТРЯЛ",
  completed: "ЗАВЕРШЁН",
  archived: "В АРХИВЕ",
};

// Shared Tailwind for every Overview card that navigates on click. The
// indigo-tinted border + 1px lift + 150ms transition is the "card looks
// clickable" affordance; pair with <CardChevron/> in the header. Cards
// with darker palettes can override the hover shadow but should keep the
// border + timing for consistency.
const CLICKABLE_CARD =
  "group/card cursor-pointer border border-transparent " +
  "hover:border-[#6366F1]/30 hover:shadow-[0_6px_24px_rgba(0,0,0,0.08)] " +
  "hover:-translate-y-[1px] transition-all duration-150 ease-in-out " +
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6366F1]/40";

// Tiny chevron that lives in the top-right of a clickable card header.
// Stays neutral until the parent card is hovered, then tints indigo so
// the affordance is obvious without being noisy at rest.
function CardChevron({ className }: { className?: string }) {
  return (
    <ChevronRight
      size={14}
      strokeWidth={2.5}
      className={cn(
        "text-gray-300 group-hover/card:text-[#6366F1] transition-colors shrink-0",
        className
      )}
    />
  );
}

// Standard activation handler for `role="button"` divs — Enter / Space
// trigger the click and Space is preventDefault'd so it doesn't scroll
// the page. Keeps every clickable card aligned with native button
// semantics without forcing us to use real <button> elements (which
// would forbid the nested interactive rows the cards already contain).
function activateOnKey(
  e: KeyboardEvent<HTMLElement>,
  onClick: () => void,
): void {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    onClick();
  }
}

function ClickableCard({
  onClick,
  ariaLabel,
  className,
  children,
}: {
  onClick: () => void;
  ariaLabel: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onClick={onClick}
      onKeyDown={(e) => activateOnKey(e, onClick)}
      className={cn(CLICKABLE_CARD, className)}
    >
      {children}
    </div>
  );
}

// Helper for inner interactive elements (buttons, links, rows) inside a
// clickable card: stops the click from bubbling up and re-triggering the
// card-level navigation, then runs the inner action. Use as the row's
// onClick so the action fires exactly once.
function stop(fn: () => void): (e: MouseEvent) => void {
  return (e) => {
    e.stopPropagation();
    fn();
  };
}

// Hide internal/transfer/aggregate + neutral buckets from the Overview chart
// so the breakdown reflects real lifestyle spending categories. "Neutral"
// categories (debt repayments, transfers) are real money movement but not
// consumption — see `NEUTRAL_CATEGORIES` in `backend/services/summary_loader.py`.
// The Finance page retains transfers in its dedicated "Internal transfers" row.
const HIDDEN_CATEGORIES = new Set<string>([
  "internal_transfer",
  "internal_transfers",
  "repayment",
  "transfers",
  "other",
  "uncategorized",
  "unknown",
  "income",
]);

// Char-based truncation with an ellipsis. Trims a trailing space before
// appending "…" so the boundary doesn't look like " …". Intentionally not
// word-aware — the spec asks for first-N-chars, and a hard cap keeps the
// compact dilemma card's footprint predictable across content.
function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n).trimEnd() + "…";
}

// Russian plural for "день" — used by the Dilemma footer pill ("16 дней").
// Kept tiny + colocated since this is the only consumer in this file;
// promote to ../lib/format if a second caller appears.
function pluralizeDays(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return "день";
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14))
    return "дня";
  return "дней";
}

// Used by the AIR4 Advisor card to phrase the stalled-projects question
// with correct noun + verb agreement:
//   1   → "1 проект застрял"
//   2-4 → "3 проекта застряли"
//   5+  → "12 проектов застряло"
function stalledProjectsPhrase(n: number): string {
  const last = n % 10;
  const teen = n % 100;
  if (last === 1 && teen !== 11) return `${n} проект застрял`;
  if (last >= 2 && last <= 4 && (teen < 12 || teen > 14))
    return `${n} проекта застряли`;
  return `${n} проектов застряло`;
}

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
    : d.toLocaleString("ru-RU", { month: "short" });
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

// Activity dot color for a project row — mirrors the
// "Make Overview cards visually consistent" spec:
//   green  → updated within 3 days
//   yellow → 4..14 days
//   red    → 14+ days
// Coarser than the bar `color` (which has two yellow shades by design);
// kept separate so the at-a-glance dot reads as a clean 3-state signal
// while the bar can still telegraph subtle gradation.
function projectActivityDot(days: number): string {
  if (days <= 3) return "bg-green-500";
  if (days <= 14) return "bg-yellow-500";
  return "bg-red-500";
}

// Tier the «Импульс N%» footer pill by aggregate momentum.
//   > 60   → healthy   (green)
//   30..60 → cooling   (yellow)
//   < 30   → at risk   (red)
// Compose with `t.footerPill` via cn() — twMerge resolves the bg/text
// overrides so the default gray pill recedes for the colored tier.
function momentumPillClass(momentum: number): string {
  if (momentum > 60) return "bg-green-50 text-green-600 font-semibold";
  if (momentum >= 30) return "bg-yellow-50 text-yellow-600 font-semibold";
  return "bg-red-50 text-red-600 font-semibold";
}

// Colors the "Свободно / Свободный капитал" pill. Returns the empty
// string when income data is missing — the caller composes with
// `t.footerPill`, so the pill falls back to its neutral gray baseline in
// that case. Shared between the KPI card and the Finance Spend Chart
// bottom card so the two surfaces never diverge.
function freeCapitalPillClass(
  hasFinance: boolean,
  totalIncome: number,
  freeCapital: number,
): string {
  if (!hasFinance || totalIncome <= 0) return "";
  return freeCapital > 0
    ? "bg-green-50 text-green-600 font-semibold"
    : "bg-red-50 text-red-600 font-semibold";
}

// Workout status pill copy + color for the Projects KPI card.
//   null → "тренировок ещё нет"        (gray, neutral)
//   < 3   → "в темпе"                   (green)
//   >= 3  → "без тренировок N дн"       (red, with short-form "дн" so
//                                        the pill stays compact)
function workoutPill(daysSince: number | null): { text: string; cls: string } {
  if (daysSince == null) {
    return { text: "Тренировок ещё нет", cls: "" };
  }
  if (daysSince >= 3) {
    return {
      text: `Без тренировок ${daysSince} дн`,
      cls: "bg-red-50 text-red-600 font-semibold",
    };
  }
  return {
    text: "В темпе",
    cls: "bg-green-50 text-green-600 font-semibold",
  };
}

// Accent palette for the Current Recommendation block, keyed by the
// backend `state`. stable = indigo (matches the old advisor card so the
// default look is unchanged), attention = amber, critical = red.
const RECO_STATE_STYLE: Record<
  RecommendationState,
  { card: string; badge: string; label: string }
> = {
  stable: { card: "bg-[#4F46E5]", badge: "bg-white/20 text-white", label: "Стабильно" },
  attention: { card: "bg-amber-500", badge: "bg-white/25 text-white", label: "Внимание" },
  critical: { card: "bg-red-600", badge: "bg-white/25 text-white", label: "Проблема" },
};

// Per-sphere health signal shown as a small dot badge on each KPI card.
// `neutral` covers the "no data yet" case so an empty sphere doesn't
// masquerade as green.
type SphereStatus = "stable" | "attention" | "critical" | "neutral";

const SPHERE_STATUS_META: Record<SphereStatus, { dot: string; label: string }> = {
  stable: { dot: "bg-green-500", label: "Стабильно" },
  attention: { dot: "bg-yellow-500", label: "Внимание" },
  critical: { dot: "bg-red-500", label: "Проблема" },
  neutral: { dot: "bg-gray-300", label: "Нет данных" },
};

// Finance: free capital > 0 → stable; spending == income → attention;
// overspent (< 0) → critical; missing income/finance data → neutral.
// NB: /api/summary returns income split across `total_income` and
// `other_incoming` — in real data `total_income` is often 0 while the
// actual inflow lands in `other_incoming`, so the badge must read both
// to avoid being stuck on neutral/gray.
function financeSphereStatus(summary: Summary | null): SphereStatus {
  if (!summary || !hasFinanceData(summary)) return "neutral";
  const income =
    (summary.total_income ?? 0) + (summary.other_incoming?.amount ?? 0);
  if (income <= 0) return "neutral";
  const freeCapital = income - (summary.total_spent ?? 0);
  if (freeCapital > 0) return "stable";
  if (freeCapital === 0) return "attention";
  return "critical";
}

// Health: >7 days without a workout → critical; 4..7 days → attention;
// otherwise stable; no workouts logged at all → neutral.
function healthSphereStatus(daysSinceWorkout: number | null): SphereStatus {
  if (daysSinceWorkout == null) return "neutral";
  if (daysSinceWorkout > 7) return "critical";
  if (daysSinceWorkout >= 4) return "attention";
  return "stable";
}

// Projects: all active projects stalled → critical; more than one
// stalled → attention; otherwise stable; no active projects → neutral.
function projectsSphereStatus(
  stalledCount: number,
  activeCount: number,
): SphereStatus {
  if (activeCount === 0) return "neutral";
  if (stalledCount >= activeCount) return "critical";
  if (stalledCount > 1) return "attention";
  return "stable";
}

// Small status dot, parked just left of the card's chevron so it reads
// in the top-right corner without colliding with it.
function SphereStatusBadge({ status }: { status: SphereStatus }) {
  const meta = SPHERE_STATUS_META[status];
  return (
    <span
      className="absolute top-6 right-12 flex items-center"
      title={meta.label}
      aria-label={`Статус: ${meta.label}`}
    >
      <span className={cn("w-2.5 h-2.5 rounded-full", meta.dot)} />
    </span>
  );
}

export function OverviewDashboard({
  summary,
  projects,
  observations,
  crossSphereInsights = [],
  insight,
  bodyMetrics,
  workouts,
  loading,
  openDilemma,
  pendingFollowups,
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
      .filter(([k]) => !HIDDEN_CATEGORIES.has(k))
      .map(([k, v]) => [k, v.amount] as [string, number])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [summary]);
  const maxCatAmount = topCategories[0]?.[1] ?? 1;

  // --- Health derived ---
  const latestWeight = latestBodyWeight(bodyMetrics);
  const bmi = bmiFromMetrics(bodyMetrics);
  const weightLabel = latestWeight ? `${latestWeight.weight} кг` : "—";
  const bmiLabel = bmi != null ? `ИМТ ${bmi}` : null;

  // --- Workout streak (last 7 days, oldest → today) ---
  const streak = useMemo(() => {
    const dates = new Set(workouts.map((w) => w.date));
    return Array.from({ length: 7 }, (_, i) => dates.has(isoMinusDays(6 - i)));
  }, [workouts]);

  const latestWorkoutDate = workouts[0]?.date ?? null;
  const daysSinceWorkout = latestWorkoutDate ? daysSince(latestWorkoutDate) : null;
  const lastWorkoutLabel = latestWorkoutDate
    ? new Date(latestWorkoutDate).toLocaleDateString("ru-RU", {
        month: "short",
        day: "numeric",
      })
    : "—";

  // --- Projects derived ---
  const totalProjects = projects.length;
  // Stalled = active project untouched for > 7 days. Kept as a list (not
  // just a count) so the AIR4 Advisor card can surface the actual
  // project names as quick-action pills; the count is just `.length`.
  const stalledList = useMemo(
    () =>
      projects.filter(
        (p) => p.status === "active" && daysSince(p.updated_at) > 7,
      ),
    [projects],
  );
  const stalledProjects = stalledList.length;

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

  // --- Current Recommendation (AIR4) ---
  // Replaces the old in-card "advisor question" flow with a single
  // opinionated recommendation fetched from the backend on mount. While
  // the request is in flight we render a skeleton; the block's accent
  // color is driven by the returned `state`. On a hard network failure
  // `recommendation` stays null and the block is omitted (the rest of
  // the dashboard is unaffected).
  const [recommendation, setRecommendation] = useState<Recommendation | null>(
    null,
  );
  const [recoLoading, setRecoLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setRecoLoading(true);
    fetchRecommendation()
      .then((data) => {
        if (!cancelled) setRecommendation(data);
      })
      .catch(() => {
        if (!cancelled) setRecommendation(null);
      })
      .finally(() => {
        if (!cancelled) setRecoLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const recoStyle = recommendation
    ? RECO_STATE_STYLE[recommendation.state]
    : null;

  // --- Per-sphere status badges (top-right dot on each KPI card) ---
  const financeStatus = financeSphereStatus(summary);
  const healthStatus = healthSphereStatus(daysSinceWorkout);
  const projectsStatus = projectsSphereStatus(
    stalledList.length,
    activeProjects.length,
  );

  const handleProjectClick = (_id: number) => {
    onPageChange("Projects");
  };

  // First-load skeleton — keep simple
  if (loading && !summary && projects.length === 0 && workouts.length === 0) {
    return (
      <div className="text-[14px] text-gray-400 px-2 py-12">Загрузка обзора…</div>
    );
  }

  return (
    // Wrapper switched from `space-y-6 pb-12` to `flex flex-col gap-8
    // pb-10` to match Finance exactly. The 8-unit gap (vs 6) gives the
    // dashboard slightly more breathing room and — more importantly —
    // matches the gap Finance uses between its inline header and its
    // first card, so flipping Overview ↔ Finance no longer makes the
    // first row of content jump.
    <div className="flex flex-col gap-8 pb-10 font-sans bg-[#F5F5F7]">
      {/* -------------------- Page header (inline, mirrors Finance) -------------------- */}
      {/* Identical structure to Finance's page header:
          [tinted icon square] [h1 + uppercase subtitle]   [actions →]
          Overview has no page-specific actions, so the right slot is
          empty — `justify-between` still pushes the title block to the
          left. Indigo badge (text-500 variant) matches the secondary-
          card badges (Активность / Паттерны / Дилемма). */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-indigo-50 text-indigo-500 rounded-xl">
            <LayoutDashboard size={22} className="fill-indigo-100" />
          </div>
          <div>
            <h1 className={cn(t.pageTitle, "text-4xl")}>Обзор</h1>
            <p className={cn(t.pageSub, "mt-0.5")}>Спутник мышления</p>
          </div>
        </div>
      </div>

      {/* -------------------- Current Recommendation (full-width, sits above the KPIs) -------------------- */}
      {/* Single opinionated recommendation from AIR4 (GET
          /api/air4/recommendation). The accent color tracks the
          returned `state` (stable=indigo, attention=amber,
          critical=red). While loading we show a skeleton pulse. The
          relative wrapper + overflow-hidden contain the decorative
          Brain watermark in the top-right. */}
      {recoLoading ? (
        <div className="relative overflow-hidden bg-[#4F46E5] rounded-2xl p-6 shadow-xl">
          <div className="relative space-y-4 animate-pulse">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-white/40" />
              <span className="h-3 w-28 rounded bg-white/30" />
            </div>
            <div className="space-y-2">
              <span className="block h-5 w-3/4 rounded bg-white/30" />
              <span className="block h-5 w-2/3 rounded bg-white/20" />
            </div>
            <span className="block h-3 w-1/3 rounded bg-white/20" />
          </div>
        </div>
      ) : recommendation && recoStyle ? (
        <div
          className={cn(
            "relative overflow-hidden rounded-2xl p-6 shadow-xl",
            recoStyle.card,
          )}
        >
          <Brain
            size={140}
            strokeWidth={1.5}
            className="absolute -top-4 -right-4 text-white/10 pointer-events-none"
          />

          <div className="relative space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
              <span className="text-[11px] font-black text-white/80 uppercase tracking-widest">
                AIR4 · Рекомендация
              </span>
              <span
                className={cn(
                  "text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full",
                  recoStyle.badge,
                )}
              >
                {recoStyle.label}
              </span>
            </div>

            {/* `pr-16` keeps the text clear of the decorative Brain
                watermark on narrow widths. */}
            <p className="text-xl font-bold text-white leading-snug pr-16">
              {recommendation.recommendation}
            </p>

            {recommendation.basis && (
              <p className="text-[13px] text-white/70 leading-snug pr-16">
                {recommendation.basis}
              </p>
            )}
          </div>
        </div>
      ) : null}

      {/* -------------------- Row 1: 3 hero cards -------------------- */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Card 1.1 — Total Spent */}
        {/* Chevron is absolutely positioned so the rest of the card can be
            cleanly centered without the chevron pulling the visual centerline
            off-axis. `top-6 right-6` matches the card's p-6 padding so the
            chevron lands at the inner top-right corner. `justify-between` is
            intentionally absent — pills snap up under the hero (mt-2) instead
            of being pushed to the bottom of the card. */}
        <ClickableCard
          onClick={() => onPageChange("Finance")}
          ariaLabel="Открыть страницу финансов"
          className="relative bg-white rounded-[20px] p-6 shadow-[0_2px_16px_rgba(0,0,0,0.06)] flex flex-col min-h-[180px]"
        >
          <CardChevron className="absolute top-6 right-6" />
          <SphereStatusBadge status={financeStatus} />

          {/* Icon sits between the small title and the hero number — the
              same green Wallet badge used in the Finance page header so
              the KPI card visually telegraphs its destination. Switched
              from `h-[180px]` to `min-h-[180px]` so adding the icon
              doesn't push pills past the cap; grid stretch keeps the
              three KPI cards row-aligned. */}
          <div className="flex flex-col items-center text-center">
            <span className={t.cardLabel}>Финансы</span>
            <div className="mt-1.5 w-8 h-8 rounded-lg bg-green-50 text-green-600 flex items-center justify-center">
              <Wallet size={16} className="fill-green-100" />
            </div>
            <span className={cn(t.hero, "mt-1.5")}>
              {hasFinance ? formatEuro(totalSpent) : "—"}
            </span>
            <span className="text-[11px] text-gray-400 font-medium mt-1">
              потрачено за цикл
            </span>
          </div>

          <div className="mt-2 flex items-center justify-center gap-2 flex-wrap">
            <span className={t.footerPill}>
              Доход{" "}
              {hasFinance && totalIncome > 0 ? formatEuro(totalIncome) : "—"}
            </span>
            <span
              className={cn(
                t.footerPill,
                freeCapitalPillClass(hasFinance, totalIncome, freeCapital),
              )}
            >
              Свободно{" "}
              {hasFinance && totalIncome > 0 ? formatEuro(freeCapital) : "—"}
            </span>
          </div>
        </ClickableCard>

        {/* Card 1.2 — Health Weight + streak */}
        <ClickableCard
          onClick={() => onPageChange("Health")}
          ariaLabel="Открыть страницу здоровья"
          className="relative bg-white rounded-[20px] p-6 shadow-[0_2px_16px_rgba(0,0,0,0.06)] flex flex-col min-h-[180px]"
        >
          <CardChevron className="absolute top-6 right-6" />
          <SphereStatusBadge status={healthStatus} />

          {/* Rose Heart badge mirrors the Health page header
              (bg-rose-50 / text-rose-600 / fill-rose-100). Sized down
              from the header's size=22/p-2 to size=16 inside a w-8 h-8
              square so it sits proportionally inside the KPI card. */}
          <div className="flex flex-col items-center text-center">
            <span className={t.cardLabel}>Здоровье</span>
            <div className="mt-1.5 w-8 h-8 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center">
              <Heart size={16} className="fill-rose-100" />
            </div>
            <span className={cn(t.hero, "mt-1.5")}>{weightLabel}</span>
            <span className="text-[11px] text-gray-400 font-medium mt-1">
              текущий вес
            </span>
          </div>

          {/* Footer row centered: BMI pill (when known) sits next to the
              7-day workout streak dots. */}
          <div className="mt-2 flex items-center justify-center gap-3">
            {bmiLabel && <span className={t.footerPill}>{bmiLabel}</span>}
            <div className="flex items-center gap-1">
              {streak.map((trained, i) => (
                // Streak is a fixed-length last-N-days array; position
                // is the only identity (Day -N…Day 0). Using a namespaced
                // index key so the intent is explicit rather than lazy.
                <span
                  key={`streak-day-${i}`}
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
        </ClickableCard>

        {/* Card 1.3 — Active Projects */}
        <ClickableCard
          onClick={() => onPageChange("Projects")}
          ariaLabel="Открыть каталог проектов"
          className="relative bg-white rounded-[20px] p-6 shadow-[0_2px_16px_rgba(0,0,0,0.06)] flex flex-col min-h-[180px]"
        >
          <CardChevron className="absolute top-6 right-6" />
          <SphereStatusBadge status={projectsStatus} />

          {/* Briefcase badge — NB: spec asked for `bg-blue-50` here so
              we use blue (not the Projects page header's indigo) to
              keep the Overview's color story consistent between this
              KPI card and the bottom "Проекты" card. If you want strict
              page-parity, swap `blue` → `indigo` in both spots. */}
          <div className="flex flex-col items-center text-center">
            <span className={t.cardLabel}>Проекты</span>
            <div className="mt-1.5 w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <Briefcase size={16} className="fill-blue-100" />
            </div>
            <span className={cn(t.hero, "mt-1.5")}>{totalProjects}</span>
            <span className="text-[11px] text-gray-400 font-medium mt-1">
              активных проекта
            </span>
          </div>

          {/* Footer pills — mirror the bottom Projects card vocabulary
              (indigo "N активных"). Adds an orange "Застряло N" when any
              active project has gone stale, and a workout-status pill so
              the embedded fitness check-in survives the redesign without
              its old gray-box treatment. Centered to match the other KPI
              cards. */}
          <div className="mt-2 flex items-center justify-center gap-2 flex-wrap">
            {(() => {
              const wp = workoutPill(daysSinceWorkout);
              return (
                <>
                  <span
                    className={cn(
                      t.footerPill,
                      "bg-indigo-50 text-indigo-600 font-semibold",
                    )}
                  >
                    {activeProjects.length} активных
                  </span>
                  {stalledProjects > 0 && (
                    <span
                      className={cn(
                        t.footerPill,
                        "bg-orange-50 text-orange-600 font-semibold",
                      )}
                    >
                      Застряло {stalledProjects}
                    </span>
                  )}
                  <span className={cn(t.footerPill, wp.cls)}>{wp.text}</span>
                </>
              );
            })()}
          </div>
        </ClickableCard>
      </div>

      {/* -------------------- AIR4 Check-in -------------------- */}
      {/* Sits below the KPI strip — different concept from the AIR4
          Advisor above (proactive interview question vs. data-driven
          nudge). Component returns null when there's no question, so
          this slot collapses cleanly during cooldown. */}
      <AIRCheckIn
        onTellInChat={(question) => onOpenChatWithMessage(question)}
      />

      {/* -------------------- Row 2: Finance (2/3) + Projects (1/3) -------------------- */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Card 2.1 — Finance Spend Chart */}
        <ClickableCard
          onClick={() => onPageChange("Finance")}
          ariaLabel="Открыть страницу финансов"
          className="bg-white rounded-[20px] p-6 shadow-[0_2px_16px_rgba(0,0,0,0.06)] flex flex-col justify-between min-h-[340px] md:col-span-2"
        >
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              {/* Inline green Wallet badge — same icon as the Finance
                  page header but shrunk to w-6 h-6 (size=14) so it
                  reads as a header marker, not a hero element. */}
              <div className="flex items-center gap-2 min-w-0">
                <div className="shrink-0 w-6 h-6 rounded-lg bg-green-50 text-green-600 flex items-center justify-center">
                  <Wallet size={14} className="fill-green-100" />
                </div>
                <span className="text-lg font-extrabold text-gray-900">
                  Структура трат
                </span>
              </div>
              <div className="flex items-center gap-2">
                {periodLabel && (
                  <span className="bg-indigo-50 text-indigo-600 text-[11px] font-bold uppercase tracking-wide px-3 py-1 rounded-full">
                    {periodLabel}
                  </span>
                )}
                <CardChevron />
              </div>
            </div>

            {topCategories.length > 0 ? (
              <div className="space-y-5 pt-3">
                {topCategories.map(([key, amount], i) => {
                  const pct = Math.max(4, Math.round((amount / maxCatAmount) * 100));
                  return (
                    <div
                      key={key}
                      className="flex items-center gap-4 text-[11px] font-bold text-gray-600"
                    >
                      <span
                        className={cn(
                          t.rowTitle,
                          "w-32 shrink-0 truncate text-left"
                        )}
                      >
                        {formatCategoryLabel(key)}
                      </span>
                      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full",
                            CATEGORY_COLORS[i % CATEGORY_COLORS.length] ??
                              "bg-gray-400"
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="font-mono w-16 shrink-0 text-right text-gray-700">
                        {formatEuro(amount)}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="pt-6">
                {/* OverviewCardEmpty's CTA goes to CSVUpload, not Finance — its
                    button is stopPropagation'd inside the component so the
                    outer card-click doesn't override the destination. */}
                <OverviewCardEmpty
                  type="finance"
                  compact
                  onAction={() => onPageChange("CSVUpload")}
                />
              </div>
            )}
          </div>

          {/* When income is unknown the pill stays neutral (gray) — there's
              no signed signal to color. Once we have income data the pill
              flips green (surplus) or red (deficit / zero). Shared with
              the Spent KPI card via `freeCapitalPillClass`. */}
          <div className="mt-4 flex items-center gap-2">
            <span
              className={cn(
                t.footerPill,
                freeCapitalPillClass(hasFinance, totalIncome, freeCapital),
              )}
            >
              Свободный капитал:{" "}
              {hasFinance && totalIncome > 0 ? formatEuro(freeCapital) : "—"}
            </span>
          </div>
        </ClickableCard>

        {/* Card 2.2 — Projects Directory */}
        <ClickableCard
          onClick={() => onPageChange("Projects")}
          ariaLabel="Открыть каталог проектов"
          className="bg-white rounded-[20px] p-6 shadow-[0_2px_16px_rgba(0,0,0,0.06)] flex flex-col justify-between min-h-[340px]"
        >
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              {/* Inline blue Briefcase badge — matches the KPI card's
                  color (blue) by spec rather than the Projects page
                  header's indigo. See KPI Card 3 comment. */}
              <div className="flex items-center gap-2 min-w-0">
                <div className="shrink-0 w-6 h-6 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                  <Briefcase size={14} className="fill-blue-100" />
                </div>
                <span className="text-lg font-extrabold text-gray-900">
                  Проекты
                </span>
              </div>
              <CardChevron />
            </div>

            {topProjects.length === 0 ? (
              <OverviewCardEmpty
                type="projects"
                compact
                onAction={() => onOpenChatWithMessage("Я хочу добавить проект")}
              />
            ) : (
              // Project rows mirror the Finance card row structure exactly
              // (label · bar · value) so the two cards read as siblings. The
              // numeric "amount" slot on Finance becomes a single recency
              // dot here; the human-readable date moves to a `title` tooltip.
              <div className="space-y-5 pt-3">
                {topProjects.map((p) => {
                  const dotColor = projectActivityDot(p.days);
                  return (
                    <div
                      key={p.id}
                      role="link"
                      tabIndex={0}
                      onClick={stop(() => handleProjectClick(p.id))}
                      onKeyDown={(e) =>
                        activateOnKey(e, () => handleProjectClick(p.id))
                      }
                      className="group/proj cursor-pointer rounded-md focus:outline-none focus-visible:ring-1 focus-visible:ring-[#6366F1]/40 flex items-center gap-4 text-[11px] font-bold text-gray-600"
                    >
                      <div className="w-32 shrink-0 flex flex-col gap-0.5 min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className={cn(
                              t.rowTitle,
                              "truncate group-hover/proj:text-[#6366F1] transition-colors"
                            )}
                          >
                            {p.name}
                          </span>
                          <span
                            className={cn(
                              "text-[8px] font-black px-1 py-0.5 rounded uppercase tracking-wider shrink-0",
                              p.status === "active"
                                ? "bg-indigo-50 text-[#6366F1]"
                                : "bg-gray-100 text-gray-500"
                            )}
                          >
                            {PROJECT_STATUS_LABEL[p.status] ?? p.status.toUpperCase()}
                          </span>
                        </div>
                        {/* Tiny goal pill under the project name —
                            shows the first linked goal so the row
                            stays compact. Hidden when the project
                            isn't linked to any (real) goal so most
                            rows keep their original 1-line height. */}
                        {p.goals?.[0]?.title && (
                          <span
                            className="text-[9px] font-semibold text-gray-400 truncate leading-tight"
                            title={
                              (p.goals?.length ?? 0) > 1
                                ? p.goals!
                                    .map((g) => g.title || `[${g.key}]`)
                                    .join(" · ")
                                : (p.goals![0].title ?? "")
                            }
                          >
                            ↳ {p.goals[0].title}
                            {(p.goals?.length ?? 0) > 1
                              ? ` +${(p.goals?.length ?? 0) - 1}`
                              : ""}
                          </span>
                        )}
                      </div>

                      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all duration-500",
                            p.color
                          )}
                          style={{ width: `${p.momentum}%` }}
                        />
                      </div>

                      {/* Same w-16 right-aligned slot as Finance amounts —
                          the dot lives at the right edge. The human-readable
                          recency string (e.g. "Вчера") survives as the
                          `title` tooltip and as the dot's aria-label. */}
                      <span
                        className="w-16 shrink-0 flex items-center justify-end"
                        title={p.activity}
                      >
                        <span
                          aria-label={p.activity}
                          className={cn(
                            "inline-block w-2.5 h-2.5 rounded-full",
                            dotColor
                          )}
                        />
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center gap-2 flex-wrap">
            <span
              className={cn(
                t.footerPill,
                "bg-indigo-50 text-indigo-600 font-semibold"
              )}
            >
              {activeProjects.length} активных
            </span>
            {topProjects.length > 0 && (
              <span
                className={cn(
                  t.footerPill,
                  momentumPillClass(overallMomentum)
                )}
              >
                Импульс {overallMomentum}%
              </span>
            )}
          </div>
        </ClickableCard>
      </div>

      {/* -------------------- Row 3: Activity · Patterns · Dilemma (3 equal columns) -------------------- */}
      {/* All three cards are 1/3 width on md+ and stack on mobile. Grid
          `align-items: stretch` (default) keeps them the same height so
          the shorter cards (Patterns / Dilemma) match LiveFeed's body. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <LiveFeed
          onCardClick={() => onPageChange("Memory")}
          digestLimit={3}
        />

        <ClickableCard
          onClick={() => onPageChange("Patterns")}
          ariaLabel="Открыть страницу паттернов"
          className="bg-white rounded-[20px] p-6 shadow-[0_2px_16px_rgba(0,0,0,0.06)] flex flex-col justify-between"
        >
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2 min-w-0">
                <div className="shrink-0 w-6 h-6 rounded-lg bg-indigo-50 text-indigo-500 flex items-center justify-center">
                  <Sparkles size={14} className="fill-indigo-100" />
                </div>
                <span className="text-lg font-extrabold text-gray-900">
                  Паттерны
                </span>
              </div>
              <CardChevron />
            </div>

            {observations.length === 0 && crossSphereInsights.length === 0 ? (
              <OverviewCardEmpty type="patterns" compact />
            ) : (
              // Two-line rows mirror the Activity feed rhythm: bold dark
              // title on top, a single muted gray subtitle line below.
              // Hard-capping body length keeps the card height stable
              // across observations whose `body` ranges from one
              // sentence to several paragraphs. The indigo left border
              // is the pattern card's signature (Activity uses a tinted
              // icon square instead) and the chevron stays so the row
              // reads as click-navigable.
              <div className="space-y-2.5 pt-1">
                {/* Cross-sphere insights surface first because they're
                    the higher-signal correlation the analyzer just
                    confirmed. Each row carries two colored domain
                    badges (sphere1 + sphere2) so the user instantly
                    sees which areas of life are connected. Capped at
                    2 so the card stays the same height as the
                    Activity/Dilemma sibling cards. */}
                {crossSphereInsights.slice(0, 2).map((ins) => {
                  const tier = confidenceTier(ins.confidence);
                  const b1 = sphereBadge(ins.sphere1);
                  const b2 = sphereBadge(ins.sphere2);
                  return (
                    <button
                      key={`cs-${ins.id}`}
                      type="button"
                      onClick={stop(() => onPageChange("Patterns"))}
                      className="w-full text-left pl-3 border-l-2 border-l-amber-400 py-1.5 flex items-start justify-between gap-2 group/cs hover:bg-amber-50/30 rounded-r-md transition-colors"
                      title={ins.description}
                    >
                      <div className="flex-1 min-w-0 pt-0.5 space-y-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span
                            className={cn(
                              "text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider border",
                              b1.className
                            )}
                          >
                            {b1.label}
                          </span>
                          <span className="text-[10px] text-gray-300 font-bold">×</span>
                          <span
                            className={cn(
                              "text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider border",
                              b2.className
                            )}
                          >
                            {b2.label}
                          </span>
                          <span
                            className="flex items-center gap-1 ml-auto"
                            title={`Уверенность ${Math.round(ins.confidence * 100)}% — ${tier.label}`}
                          >
                            <span
                              aria-hidden="true"
                              className={cn(
                                "inline-block w-1.5 h-1.5 rounded-full",
                                tier.dotClass
                              )}
                            />
                          </span>
                        </div>
                        <p className="text-[13px] font-semibold text-gray-800 leading-snug group-hover/cs:text-amber-700 transition-colors">
                          {truncate(ins.title, 48)}
                        </p>
                      </div>
                      <ChevronRight
                        size={14}
                        className="text-gray-300 group-hover/cs:text-amber-500 transition-colors shrink-0 mt-1"
                      />
                    </button>
                  );
                })}

                {observations.slice(0, Math.max(0, 2 - crossSphereInsights.length)).map((obs) => (
                  // Inner-row click goes to Patterns (same destination as
                  // the card itself), but we stop propagation anyway so the
                  // event handler runs exactly once and future per-row
                  // navigation (e.g. open a single observation) is a
                  // one-line change instead of a regression hunt.
                  <button
                    key={obs.id}
                    type="button"
                    onClick={stop(() => onPageChange("Patterns"))}
                    className="w-full text-left pl-3 border-l-2 border-l-[#6366F1] py-1.5 flex items-start justify-between gap-2 group/obs hover:bg-indigo-50/30 rounded-r-md transition-colors"
                  >
                    <div className="flex-1 min-w-0 pt-0.5">
                      <p className="text-[13px] font-semibold text-gray-800 leading-snug group-hover/obs:text-[#6366F1] transition-colors">
                        {truncate(obs.title, 40)}
                      </p>
                      {obs.body && (
                        <p className="text-[11px] text-gray-400 font-medium leading-snug mt-0.5">
                          {truncate(obs.body, 60)}
                        </p>
                      )}
                    </div>
                    <ChevronRight
                      size={14}
                      className="text-gray-300 group-hover/obs:text-[#6366F1] transition-colors shrink-0 mt-1"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          {(observations.length > 0 || crossSphereInsights.length > 0) && (
            <div className="mt-4 flex items-center gap-2 flex-wrap">
              {crossSphereInsights.length > 0 && (
                <span
                  className={cn(
                    t.footerPill,
                    "bg-amber-50 text-amber-700 font-semibold whitespace-nowrap"
                  )}
                  title="Связи между сферами, найденные анализатором"
                >
                  {crossSphereInsights.length}{" "}
                  {crossSphereInsights.length % 10 === 1 && crossSphereInsights.length % 100 !== 11
                    ? "связь"
                    : crossSphereInsights.length % 10 >= 2 && crossSphereInsights.length % 10 <= 4 && (crossSphereInsights.length % 100 < 12 || crossSphereInsights.length % 100 > 14)
                    ? "связи"
                    : "связей"}{" "}
                  между сферами
                </span>
              )}
              {observations.length > 0 && (
                <span
                  className={cn(
                    t.footerPill,
                    "bg-orange-50 text-orange-600 font-semibold"
                  )}
                >
                  {observations.length}{" "}
                  {observations.length % 10 === 1 && observations.length % 100 !== 11
                    ? "аномалия"
                    : observations.length % 10 >= 2 && observations.length % 10 <= 4 && (observations.length % 100 < 12 || observations.length % 100 > 14)
                    ? "аномалии"
                    : "аномалий"}
                </span>
              )}
              <span className={cn(t.footerPill, "whitespace-nowrap")}>
                AI оценка согласована
              </span>
            </div>
          )}
        </ClickableCard>

        {/* Compact Dilemma card — sibling of Activity / Patterns. Always
            renders so the 3-column grid stays a clean 1:1:1 (no orphan
            empty cell). When there's no open dilemma the card shows a
            small neutral empty state but stays click-navigable so users
            can land on the Dilemmas page and create one. The previous
            full-width dilemma row + "ГЛАВНАЯ ДИЛЕММА" eyebrow + giant
            right-rail day counter were retired here. */}
        <ClickableCard
          onClick={() => onPageChange("Dilemmas")}
          ariaLabel="Открыть страницу дилемм"
          className="bg-white rounded-[20px] p-6 shadow-[0_2px_16px_rgba(0,0,0,0.06)] flex flex-col justify-between"
        >
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2 min-w-0">
                <div className="shrink-0 w-6 h-6 rounded-lg bg-orange-50 text-orange-500 flex items-center justify-center">
                  <Scale size={14} className="fill-orange-100" />
                </div>
                <span className="text-lg font-extrabold text-gray-900">
                  Дилемма
                </span>
              </div>
              <CardChevron />
            </div>

            {openDilemma ? (
              // Indigo left-rail mirrors the Паттерны row treatment so
              // the two cards share a single content-block vocabulary.
              // Title + description typography drop down a notch from
              // their previous heavier weights to match a pattern row;
              // `line-clamp-2` replaces the old hard 100-char cap so
              // longer descriptions wrap cleanly without an inline cut.
              <div className="border-l-2 border-l-[#6366F1] pl-3">
                <p className="text-[13px] font-semibold text-gray-800 leading-snug">
                  {openDilemma.title}
                </p>
                {openDilemma.description && (
                  <p className="text-[11px] text-gray-400 mt-1 leading-snug line-clamp-2">
                    {openDilemma.description}
                  </p>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-center py-8">
                <div className="rounded-[16px] bg-gray-50 text-[#d1d5db] p-3 mb-3">
                  <Scale size={28} strokeWidth={1.5} />
                </div>
                <p className="text-[13px] font-bold text-[#111827] leading-tight">
                  Открытых дилемм нет
                </p>
                <p className="text-[12px] text-[#9ca3af] font-medium mt-1.5 leading-relaxed">
                  Спросите AIR4, когда столкнётесь с выбором
                </p>
              </div>
            )}
          </div>

          {openDilemma && (
            // Status pill stays orange because `openDilemma` is, by
            // contract, status="open" — the API selects it as the
            // single currently-open dilemma. If we later surface
            // non-open dilemmas in this slot, swap to a status→pill
            // lookup similar to `workoutPill` / `momentumPillClass`.
            <div className="mt-4 flex items-center gap-2 flex-wrap">
              <span
                className={cn(
                  t.footerPill,
                  "bg-orange-50 text-orange-600 font-semibold",
                )}
              >
                Открыто
              </span>
              {dilemmaDays != null && (
                <span className={t.footerPill}>
                  {dilemmaDays} {pluralizeDays(dilemmaDays)}
                </span>
              )}
            </div>
          )}
        </ClickableCard>
      </div>
    </div>
  );
}
