import { useCallback, useMemo, useState } from "react";
import {
  Brain,
  ChevronRight,
  RefreshCw,
  Repeat,
  X,
} from "lucide-react";
import type {
  CrossSphere,
  CrossSphereInsight,
  Hypothesis,
} from "../lib/api";
import { cn } from "../lib/utils";
import { t } from "../lib/typography";
import { PageEmptyState } from "./PageEmptyState";

type Props = {
  hypotheses: Hypothesis[];
  /** Cross-sphere insights served by /api/cross-sphere — already
   *  loaded by the App so the page renders synchronously and the
   *  refresh button just nudges the parent's loader. */
  crossSphereInsights?: CrossSphereInsight[];
  /** Triggers POST /api/observations/generate on the backend (which
   *  also runs the cross-sphere analyzer) and reloads hypotheses +
   *  observations + cross-sphere insights in the App. */
  onRefresh?: () => Promise<void> | void;
};

// ----------------------------- helpers ----------------------------- #

function statusBadge(status: string): { label: string; className: string } {
  const s = status.toLowerCase();
  if (s === "confirmed") {
    return { label: "ПОДТВЕРЖДЕНО", className: "bg-green-50 text-green-600" };
  }
  if (s === "rejected") {
    return { label: "ОТКЛОНЕНО", className: "bg-red-50 text-red-600" };
  }
  return { label: "ОЖИДАЕТ", className: "bg-white/5 text-[#94a3b8]" };
}

function ConfidenceIndicator({ confidence }: { confidence: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, confidence)) * 100);
  const filled = Math.max(0, Math.min(5, Math.round(confidence * 5)));

  return (
    <div className="flex items-center gap-2" title={`${pct}% уверенности`}>
      <div className="flex gap-0.5">
        {Array.from({ length: 5 }, (_, i) => (
          <span
            key={i}
            className={cn(
              "w-1.5 h-1.5 rounded-full",
              i < filled ? "bg-[#f97316]" : "bg-white/10"
            )}
          />
        ))}
      </div>
      <span className="font-mono text-[11px] font-bold text-[#94a3b8]">{pct}%</span>
    </div>
  );
}

function domainLabel(domain: string): string {
  return domain.replace(/_/g, " ");
}

// Per-domain accent palette for hypothesis domain pills. Each sphere
// keeps its own hue so the pills read as category markers; unknown
// domains fall back to the orange accent.
function domainColorClass(domain: string): string {
  switch ((domain || "").toLowerCase()) {
    case "finance":
      return "bg-[#3b82f6]/15 text-[#3b82f6] border-[#3b82f6]/30";
    case "health":
    case "sport":
      return "bg-[#22c55e]/15 text-[#22c55e] border-[#22c55e]/30";
    case "projects":
      return "bg-[#a855f7]/15 text-[#a855f7] border-[#a855f7]/30";
    case "life":
      return "bg-[#f97316]/15 text-[#f97316] border-[#f97316]/30";
    case "personal":
      return "bg-[#ec4899]/15 text-[#ec4899] border-[#ec4899]/30";
    default:
      return "bg-[#f97316]/15 text-[#f97316] border-[#f97316]/30";
  }
}

/** Two-tone palette per sphere — kept in sync with the Overview
 *  Patterns card so the same insight reads identically in both
 *  contexts. Unknown spheres fall back to neutral gray. */
const SPHERE_BADGE: Record<CrossSphere | "default", {
  label: string;
  className: string;
}> = {
  finance: {
    label: "ФИНАНСЫ",
    className: "bg-[#3b82f6]/15 text-[#3b82f6] border-[#3b82f6]/30",
  },
  health: {
    label: "ЗДОРОВЬЕ",
    className: "bg-[#22c55e]/15 text-[#22c55e] border-[#22c55e]/30",
  },
  projects: {
    label: "ПРОЕКТЫ",
    className: "bg-[#a855f7]/15 text-[#a855f7] border-[#a855f7]/30",
  },
  life: {
    label: "ЖИЗНЬ",
    className: "bg-[#f97316]/15 text-[#f97316] border-[#f97316]/30",
  },
  default: {
    label: "—",
    className: "bg-[#f97316]/15 text-[#f97316] border-[#f97316]/30",
  },
};

function sphereBadge(sphere: string) {
  const key = (sphere || "").toLowerCase() as CrossSphere;
  return SPHERE_BADGE[key] ?? SPHERE_BADGE.default;
}

/** Honest tone tier — mirrors the backend's prefix logic so the user
 *  sees the same signal strength language in pill form. */
function confidenceTier(confidence: number): {
  label: string;
  dotClass: string;
  pillClass: string;
} {
  if (confidence < 0.5) {
    return {
      label: "слабый сигнал",
      dotClass: "bg-[#6b7280]",
      pillClass: "bg-[#6b7280]/15 text-[#6b7280] border-[#6b7280]/30",
    };
  }
  if (confidence <= 0.7) {
    return {
      label: "паттерн",
      dotClass: "bg-[#f97316]",
      pillClass: "bg-[#f97316]/15 text-[#f97316] border-[#f97316]/30",
    };
  }
  return {
    label: "уверенно",
    dotClass: "bg-[#22c55e]",
    pillClass: "bg-[#22c55e]/15 text-[#22c55e] border-[#22c55e]/30",
  };
}

/** Parse a backend timestamp (with or without `T`/`Z`) into a Date
 *  or null. Returns null on anything we can't parse instead of NaN
 *  so callers can safely chain comparisons. */
function parseTimestamp(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const normalized = raw.includes("T") ? raw : `${raw.replace(" ", "T")}Z`;
  const ts = Date.parse(normalized);
  return Number.isNaN(ts) ? null : new Date(ts);
}

function daysAgo(raw: string | null | undefined): number | null {
  const d = parseTimestamp(raw);
  if (!d) return null;
  return Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60 * 1000));
}

/** A hypothesis counts as "stale" when it's been sitting in the
 *  pending state for over 30 days with only one or zero confirmations.
 *  Kept as a function (not inline) so the filter logic and the
 *  "Показать все" toggle stay readable. */
function isStaleHypothesis(h: Hypothesis): boolean {
  if ((h.status || "").toLowerCase() !== "pending") return false;
  if ((h.evidence_count ?? 0) > 1) return false;
  const age = daysAgo(h.created_at);
  return age !== null && age > 30;
}

// ----------------------------- component --------------------------- #

export function Patterns({
  hypotheses,
  crossSphereInsights = [],
  onRefresh,
}: Props) {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [showStale, setShowStale] = useState(false);

  // Newest cross-sphere insights first — backend already sorts by
  // confidence DESC then created_at DESC, but a stable client-side
  // sort guarantees the order survives any future API change.
  const sortedInsights = useMemo(
    () =>
      [...crossSphereInsights].sort((a, b) => {
        if (b.confidence !== a.confidence) return b.confidence - a.confidence;
        const at = parseTimestamp(a.created_at)?.getTime() ?? 0;
        const bt = parseTimestamp(b.created_at)?.getTime() ?? 0;
        return bt - at;
      }),
    [crossSphereInsights]
  );

  const staleHypotheses = useMemo(
    () => hypotheses.filter(isStaleHypothesis),
    [hypotheses]
  );
  const freshHypotheses = useMemo(
    () => hypotheses.filter((h) => !isStaleHypothesis(h)),
    [hypotheses]
  );
  const visibleHypotheses = showStale ? hypotheses : freshHypotheses;

  const handleRefresh = useCallback(async () => {
    if (!onRefresh || refreshing) return;
    setRefreshing(true);
    setRefreshError(null);
    try {
      await onRefresh();
    } catch (err) {
      setRefreshError(
        err instanceof Error
          ? err.message
          : "Не удалось обновить паттерны"
      );
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh, refreshing]);

  const header = (
    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 animate-fade-in-up animate-delay-1">
      <div className="flex items-center gap-2.5">
        <div className="p-2 bg-[#f97316]/15 text-[#f97316] rounded-xl">
          <Repeat size={22} className="fill-[#f97316]/20" />
        </div>
        <div>
          <h1 className={t.pageTitle}>Поведенческие паттерны</h1>
          <p className={cn(t.pageSub, "mt-0.5")}>
            Связи между сферами и подтверждённые гипотезы
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        {onRefresh && (
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-[12px]",
              "bg-[#f97316] hover:bg-[#ea6a06] text-white shadow-md shadow-[#f97316]/20",
              "uppercase tracking-wider transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            )}
            title="Перезапустить анализатор и обновить cross-sphere insights"
          >
            <RefreshCw
              size={14}
              className={cn(refreshing && "animate-spin")}
            />
            {refreshing ? "Обновляется…" : "Обновить паттерны"}
          </button>
        )}
      </div>
    </div>
  );

  // Combined empty state — fires only when *both* the cross-sphere
  // analyzer and the hypothesis engine have produced nothing. Keeps
  // the page from showing two separate empty cards in a row.
  const allEmpty =
    sortedInsights.length === 0 && hypotheses.length === 0;

  if (allEmpty) {
    return (
      <div className="flex flex-col gap-8 pb-10">
        {header}
        <PageEmptyState
          icon={Brain}
          title="Паттернов пока нет"
          subtext="AIR4 ещё накапливает данные."
        />
        <p className="text-[13px] text-center text-[#94a3b8] font-medium max-w-2xl mx-auto leading-relaxed">
          AIR4 ещё накапливает данные. Паттерны появятся после нескольких
          недель использования — продолжайте логировать тренировки,
          транзакции и работу над проектами.
        </p>
        {refreshError && (
          <p className="text-center text-[12px] text-rose-500 font-medium">
            {refreshError}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 pb-10">
      {header}

      {refreshError && (
        <div className="bg-rose-50 border border-rose-100 p-3 rounded-2xl text-[12px] text-rose-600 font-medium">
          {refreshError}
        </div>
      )}

      {/* ============== Cross-sphere insights ============== */}
      {sortedInsights.length > 0 && (
        <div className="bg-[#13131f] border border-white/5 rounded-2xl p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)] space-y-5 card-hover animate-fade-in-up animate-delay-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-lg font-extrabold text-[#f1f5f9]">
                Связи между сферами
              </h2>
              <p className="text-[12px] text-[#94a3b8] mt-0.5 font-medium">
                Корреляции, которые AIR4 нашёл между финансами, здоровьем
                и проектами за последние 12 недель.
              </p>
            </div>
            <span
              className="text-[11px] font-bold text-[#f97316] bg-[#f97316]/15 border border-[#f97316]/30 px-2.5 py-1 rounded-full"
              title="Кросс-сферные связи обновляются раз в сутки"
            >
              {sortedInsights.length}{" "}
              {sortedInsights.length % 10 === 1 && sortedInsights.length % 100 !== 11
                ? "связь"
                : sortedInsights.length % 10 >= 2 && sortedInsights.length % 10 <= 4 && (sortedInsights.length % 100 < 12 || sortedInsights.length % 100 > 14)
                ? "связи"
                : "связей"}
            </span>
          </div>

          <ul className="space-y-3">
            {sortedInsights.map((ins) => {
              const tier = confidenceTier(ins.confidence);
              const b1 = sphereBadge(ins.sphere1);
              const b2 = sphereBadge(ins.sphere2);
              const age = daysAgo(ins.created_at);
              return (
                <li
                  key={`cs-${ins.id}`}
                  className="p-5 rounded-2xl bg-[#1e1e2e] border border-white/5 space-y-3 card-hover"
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className={cn(
                          "text-[9px] font-black px-2 py-0.5 rounded-md uppercase tracking-wider border",
                          b1.className
                        )}
                      >
                        {b1.label}
                      </span>
                      <span className="text-[12px] text-[#64748b] font-bold">×</span>
                      <span
                        className={cn(
                          "text-[9px] font-black px-2 py-0.5 rounded-md uppercase tracking-wider border",
                          b2.className
                        )}
                      >
                        {b2.label}
                      </span>
                    </div>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider",
                        tier.pillClass
                      )}
                      title={`Уверенность ${Math.round(ins.confidence * 100)}%`}
                    >
                      <span
                        aria-hidden="true"
                        className={cn("w-1.5 h-1.5 rounded-full", tier.dotClass)}
                      />
                      {tier.label} · {Math.round(ins.confidence * 100)}%
                    </span>
                  </div>

                  <h3 className="text-[16px] font-semibold text-[#f1f5f9] leading-snug">
                    {ins.title}
                  </h3>

                  <p className="text-[14px] text-[#94a3b8] leading-relaxed">
                    {ins.description}
                  </p>

                  {age !== null && (
                    <p className="text-[11px] text-[#64748b] font-medium uppercase tracking-wider">
                      Найдено{" "}
                      {age === 0
                        ? "сегодня"
                        : age === 1
                          ? "вчера"
                          : `${age} дней назад`}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ============== Hypotheses ============== */}
      {hypotheses.length > 0 ? (
        <div className="bg-[#13131f] border border-white/5 rounded-2xl p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)] space-y-5 card-hover animate-fade-in-up animate-delay-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-lg font-extrabold text-[#f1f5f9]">
                Обнаруженные паттерны
              </h2>
              <p className="text-[12px] text-[#94a3b8] mt-0.5 font-medium">
                Гипотезы AIR4 о повторяющихся привычках — подтверждаются
                по мере накопления подтверждений.
              </p>
            </div>
            {staleHypotheses.length > 0 && (
              <button
                type="button"
                onClick={() => setShowStale((v) => !v)}
                className={cn(
                  "flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg border transition-colors",
                  showStale
                  ? "bg-white/5 border-white/5 text-[#cbd5e1] hover:bg-white/5"
                  : "bg-[#13131f] border-white/5 text-[#94a3b8] hover:bg-white/5"
                )}
                title="Скрывает гипотезы старше 30 дней с одним подтверждением"
              >
                {showStale ? (
                  <>
                    <X size={11} />
                    Скрыть старые ({staleHypotheses.length})
                  </>
                ) : (
                  <>
                    <ChevronRight size={11} />
                    Показать старые ({staleHypotheses.length})
                  </>
                )}
              </button>
            )}
          </div>

          <ul className="space-y-4">
            {visibleHypotheses.map((h) => {
              const badge = statusBadge(h.status);
              const count = h.evidence_count;
              const confirmations =
                count === 1 ? "1 подтверждение" : `${count} подтверждений`;
              const age = daysAgo(h.created_at);
              const stale = isStaleHypothesis(h);

              return (
                <li
                  key={h.id}
                  className={cn(
                    "p-4 rounded-2xl border card-hover",
                    stale
                      ? "bg-[#1e1e2e] border-white/5 opacity-75"
                      : "bg-[#1e1e2e] border-white/5"
                  )}
                >
                  <div className="flex justify-between items-start gap-4 mb-3">
                    <p className="text-[16px] font-semibold text-[#f1f5f9] leading-snug flex-1 min-w-0">
                      {h.text}
                    </p>
                    <span
                      className={cn(
                        "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-tighter shrink-0",
                        badge.className
                      )}
                    >
                      {badge.label}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <ConfidenceIndicator confidence={h.confidence} />
                    <span className="text-[12px] text-[#94a3b8] font-medium">
                      {confirmations}
                    </span>
                    {age !== null && (
                      <span
                        className={cn(
                          "text-[11px] font-medium",
                          stale ? "text-rose-400" : "text-[#94a3b8]"
                        )}
                        title={h.created_at ?? undefined}
                      >
                        {stale
                          ? `Устарела (${age} дн.)`
                          : age === 0
                            ? "Сегодня"
                            : age === 1
                              ? "Вчера"
                              : `${age} дн. назад`}
                      </span>
                    )}
                  </div>

                  {h.domains.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {h.domains.map((domain) => (
                        <span
                          key={domain}
                          className={cn(
                            "text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md border",
                            domainColorClass(domain)
                          )}
                        >
                          {domainLabel(domain)}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {visibleHypotheses.length === 0 && (
            <div className="bg-white/5 border border-dashed border-white/5 rounded-2xl p-5 text-center">
              <p className="text-[12px] text-[#94a3b8] font-medium">
                Все гипотезы устарели — нажмите «Показать старые», чтобы
                их раскрыть.
              </p>
            </div>
          )}
        </div>
      ) : (
        // Cross-sphere exists but no hypotheses — still show a slim
        // explainer so the page doesn't look like it's missing a half.
        <div className="bg-[#13131f] border border-white/5 rounded-2xl p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)] text-center card-hover animate-fade-in-up animate-delay-3">
          <p className="text-[13px] text-[#94a3b8] font-medium">
            Поведенческих гипотез ещё нет — продолжайте логировать
            активность, AIR4 заметит повторения.
          </p>
        </div>
      )}
    </div>
  );
}
