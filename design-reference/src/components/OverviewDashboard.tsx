import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import {
  ArrowRight,
  ArrowUp,
  Dumbbell,
  Info,
  Sparkles,
} from "lucide-react";
import {
  fetchDomainRecommendations,
  fetchEvents,
  fetchHypotheses,
  fetchMonthlyFixed,
  fetchObserverToday,
  fetchProfile,
  fetchSubscriptions,
  hasFinanceData,
  type BodyMetric,
  type ChatLaunchRequest,
  type CrossSphereInsight,
  type Dilemma,
  type Observation,
  type OverviewRecommendations,
  type PrimaryThinking,
  type SecondarySignal,
  type ObserverToday,
  type ObserverTodayAggregated,
  type Project,
  type Summary,
  type UserFact,
  type Workout,
} from "../lib/api";
import { daysSince } from "../lib/format";
import { Page } from "../types";

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
  onOpenChatWithMessage: (request: ChatLaunchRequest) => void;
};

const C = {
  bg: "#0f0f14",
  card: "#13131f",
  border: "rgba(255,255,255,0.06)",
  primary: "#f1f5f9",
  muted: "#666666",
  label: "#64748b",
  orange: "#f97316",
  green: "#22c55e",
  gray: "#6b7280",
};

const LABEL_CLASS =
  "text-[11px] uppercase tracking-[0.08em] text-[#64748b] font-semibold";

const METRIC_VALUE_CLASS =
  "text-[36px] font-semibold text-white leading-none tabular-nums tracking-tight";

const METRIC_SUFFIX_CLASS = "text-[20px] font-normal text-[#666666]";

const METRIC_CAPTION_CLASS = "text-[12px] mt-1.5 text-[#666666]";

const META_LABEL_CLASS = "text-[12px] text-[#666666]";

const CARD_FOOTER_CLASS = "text-[12px] font-medium mt-auto pt-4";

const SECONDARY_LABEL_CLASS =
  "text-[12px] font-medium text-[#666666] mb-2 mt-5";

const DOMAIN_CHAT_PREFIX: Record<PrimaryThinking["domain"], string> = {
  finance: "Давай разберём финансовую ситуацию",
  projects: "Давай разберём проекты",
  health: "Давай разберём спорт и здоровье",
};

const DOMAIN_BADGE: Record<PrimaryThinking["domain"], string> = {
  finance: "финансы",
  projects: "проекты",
  health: "здоровье",
};

const DOMAIN_TILE_LABEL: Record<PrimaryThinking["domain"], string> = {
  finance: "Финансы",
  projects: "Проекты",
  health: "Здоровье",
};

const WEEK_GOAL = 4;
const OBSERVER_REFRESH_MS = 5 * 60 * 1000;

function localDateKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isToday(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const normalized = iso.includes("T") ? iso : iso.replace(" ", "T");
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return false;
  return localDateKey(d) === localDateKey(new Date());
}

function formatObserverDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}мин`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}ч ${m}мин` : `${h}ч`;
}

function formatObserverAppLabel(item: ObserverTodayAggregated): string {
  return item.project ? `${item.app} · ${item.project}` : item.app;
}

function formatProjectActivityLabel(project: Project): string {
  if (isToday(project.updated_at)) {
    return `${project.name} — активен сегодня`;
  }
  const days = daysSince(project.updated_at);
  if (days >= 999) return "нет активности";
  return `${days}д назад`;
}

function buildPrimaryChatRequest(primary: PrimaryThinking): ChatLaunchRequest {
  return {
    message: `${DOMAIN_CHAT_PREFIX[primary.domain]}: ${primary.sees} ${primary.understands}`,
    agent: primary.domain,
    autoSend: true,
  };
}

function buildSecondaryChatRequest(signal: SecondarySignal): ChatLaunchRequest {
  return {
    message: `${DOMAIN_CHAT_PREFIX[signal.domain]}: ${signal.one_line}`,
    agent: signal.domain,
    autoSend: true,
  };
}

function findSecondarySignal(
  recommendations: OverviewRecommendations | null,
  domain: PrimaryThinking["domain"],
): SecondarySignal | undefined {
  return recommendations?.secondary.find((s) => s.domain === domain);
}

function pluralOpenQuestions(n: number): string {
  const last = n % 10;
  const teen = n % 100;
  if (last === 1 && teen !== 11) return "открытый вопрос";
  if (last >= 2 && last <= 4 && (teen < 12 || teen > 14))
    return "открытых вопроса";
  return "открытых вопросов";
}

function truncateChars(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function freeCapitalAmount(summary: Summary | null): number | null {
  if (!summary || !hasFinanceData(summary)) return null;
  const income =
    (summary.total_income ?? 0) + (summary.other_incoming?.amount ?? 0);
  return income - (summary.total_spent ?? 0);
}

function formatEuroDisplay(amount: number): string {
  return `${Math.round(amount).toLocaleString("en-US")} €`;
}

function projectMomentum(updatedAt: string | null | undefined): number {
  const days = updatedAt ? daysSince(updatedAt) : 999;
  if (days >= 14) return 15;
  if (days >= 7) return 30;
  if (days >= 3) return 55;
  return Math.max(60, 95 - days * 8);
}

function progressFillColor(pct: number): string {
  return pct >= 70 ? C.green : C.orange;
}

function Card({
  className = "",
  onClick,
  children,
}: {
  className?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  const base = `rounded-[20px] p-6 border border-white/[0.06] flex flex-col h-full ${
    onClick
      ? "cursor-pointer transition-[border-color] duration-200 hover:border-[rgba(249,115,22,0.3)]"
      : ""
  }`;

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${base} text-left w-full ${className}`}
        style={{ backgroundColor: C.card }}
      >
        {children}
      </button>
    );
  }

  return (
    <div
      className={`${base} ${className}`}
      style={{ backgroundColor: C.card }}
    >
      {children}
    </div>
  );
}

function DetailLink({
  onClick,
}: {
  onClick: (e: MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      className="text-[12px] transition-colors duration-200"
      style={{ color: C.muted }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = C.orange;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = C.muted;
      }}
    >
      Подробнее ›
    </button>
  );
}

function ProgressBar({ pct, color, className = "" }: { pct: number; color?: string; className?: string }) {
  const fill = color ?? progressFillColor(pct);
  return (
    <div className={`h-1 rounded-[2px] overflow-hidden bg-white/[0.08] ${className}`}>
      <div
        className="h-full rounded-[2px] transition-all duration-500"
        style={{ width: `${Math.min(100, Math.max(0, pct))}%`, backgroundColor: fill }}
      />
    </div>
  );
}

function TileHeader({
  label,
  onDetail,
  trailing,
}: {
  label: string;
  onDetail: (e: MouseEvent) => void;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-1.5">
        <span className={LABEL_CLASS}>{label}</span>
        {trailing}
      </div>
      <DetailLink onClick={onDetail} />
    </div>
  );
}

function MetricValue({
  children,
  suffix,
}: {
  children: ReactNode;
  suffix?: ReactNode;
}) {
  return (
    <p className={METRIC_VALUE_CLASS}>
      {children}
      {suffix != null && (
        <span className={METRIC_SUFFIX_CLASS}> {suffix}</span>
      )}
    </p>
  );
}

function ThinkingSection({
  icon,
  label,
  text,
}: {
  icon: string;
  label: string;
  text: string;
}) {
  return (
    <div>
      <p
        className="text-[11px] uppercase tracking-[0.08em] font-semibold mb-2"
        style={{ color: C.label }}
      >
        {icon} {label}
      </p>
      <p className="text-[14px] leading-[1.6] text-[#e2e8f0]">{text}</p>
    </div>
  );
}

function StatusDot({
  color,
  label,
}: {
  color: string;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 text-[12px]" style={{ color: C.muted }}>
      <span
        className="w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: color }}
      />
      <span>{label}</span>
    </div>
  );
}

export function OverviewDashboard({
  summary,
  projects,
  observations,
  workouts,
  onPageChange,
  onOpenChatWithMessage,
}: Props) {
  const [recommendations, setRecommendations] =
    useState<OverviewRecommendations | null>(null);
  const [recoLoading, setRecoLoading] = useState(true);
  const [name, setName] = useState<string | null>(null);
  const [facts, setFacts] = useState<UserFact[]>([]);
  const [activeSubsCount, setActiveSubsCount] = useState(0);
  const [monthlyFixedTotal, setMonthlyFixedTotal] = useState<number | null>(null);
  const [eventsTotal, setEventsTotal] = useState(0);
  const [confirmedPatterns, setConfirmedPatterns] = useState(0);
  const [observerToday, setObserverToday] = useState<ObserverToday | null>(null);
  const [observerLoading, setObserverLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setRecoLoading(true);

    void Promise.allSettled([
      fetchDomainRecommendations(),
      fetchProfile(),
      fetchSubscriptions(),
      fetchMonthlyFixed(),
      fetchEvents(),
      fetchHypotheses(),
    ]).then(
      ([recoRes, profileRes, subsRes, fixedRes, eventsRes, hypRes]) => {
        if (cancelled) return;

        if (recoRes.status === "fulfilled") {
          setRecommendations(recoRes.value);
        } else {
          setRecommendations(null);
        }
        setRecoLoading(false);

        if (profileRes.status === "fulfilled") {
          setName(profileRes.value.profile?.name ?? null);
          setFacts(profileRes.value.facts ?? []);
        }

        if (subsRes.status === "fulfilled") {
          setActiveSubsCount(
            subsRes.value.subscriptions.filter((s) => s.is_active).length,
          );
        }

        if (fixedRes.status === "fulfilled") {
          setMonthlyFixedTotal(fixedRes.value.fixed_total);
        }

        if (eventsRes.status === "fulfilled") {
          setEventsTotal(eventsRes.value.total || eventsRes.value.events.length);
        }

        if (hypRes.status === "fulfilled") {
          setConfirmedPatterns(
            hypRes.value.hypotheses.filter(
              (h) => h.status.toLowerCase() === "confirmed",
            ).length,
          );
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadObserver = async () => {
      try {
        const data = await fetchObserverToday();
        if (!cancelled) setObserverToday(data);
      } catch {
        if (!cancelled) setObserverToday(null);
      } finally {
        if (!cancelled) setObserverLoading(false);
      }
    };

    void loadObserver();
    const id = window.setInterval(() => {
      void loadObserver();
    }, OBSERVER_REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const observerApps = useMemo(
    () => (observerToday?.by_app_aggregated ?? []).slice(0, 3),
    [observerToday],
  );

  const observerMaxMinutes = useMemo(
    () =>
      Math.max(
        1,
        ...(observerToday?.by_app_aggregated ?? []).map((a) => a.total_minutes),
      ),
    [observerToday],
  );

  const observerHasData = (observerToday?.total_minutes ?? 0) > 0;

  const activeProjects = useMemo(
    () => projects.filter((p) => p.status === "active"),
    [projects],
  );

  const waitingProjects = useMemo(
    () => projects.filter((p) => p.status !== "active").length,
    [projects],
  );

  const topProject = useMemo(() => {
    if (activeProjects.length === 0) return null;
    return [...activeProjects].sort(
      (a, b) => daysSince(a.updated_at) - daysSince(b.updated_at),
    )[0];
  }, [activeProjects]);

  const topProjectPct = topProject
    ? projectMomentum(topProject.updated_at)
    : 0;

  const allOpenLoops = useMemo(
    () => observations.filter((o) => !o.is_read),
    [observations],
  );

  const weekWorkouts = useMemo(
    () => workouts.filter((w) => daysSince(w.date) <= 7).length,
    [workouts],
  );

  const financeSignal = findSecondarySignal(recommendations, "finance");
  const projectsSignal = findSecondarySignal(recommendations, "projects");
  const healthSignal = findSecondarySignal(recommendations, "health");

  const freeCapital = freeCapitalAmount(summary);
  const currentSavings = freeCapital != null ? Math.max(0, freeCapital) : null;
  const income =
    (summary?.total_income ?? 0) + (summary?.other_incoming?.amount ?? 0);
  const savingsTarget = useMemo(() => {
    if (monthlyFixedTotal != null && monthlyFixedTotal > 0) {
      return Math.round(monthlyFixedTotal * 3);
    }
    if (income > 0) return Math.round(income * 0.5);
    return 1500;
  }, [monthlyFixedTotal, income]);

  const savingsPct =
    currentSavings != null && savingsTarget > 0
      ? Math.round((currentSavings / savingsTarget) * 100)
      : 0;

  const incomeStable = income > 0;
  const reserveBelowTarget =
    currentSavings != null && currentSavings < savingsTarget;

  const healthToday =
    healthSignal?.one_line ??
    (weekWorkouts > 0 ? `${weekWorkouts} тренировок на этой неделе` : "тренировка");

  const now = new Date();
  const dateLabel = `${now.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
  })}, ${now.toLocaleDateString("ru-RU", { weekday: "long" })}`;

  const memoryEvents = eventsTotal > 0 ? eventsTotal : facts.length;
  const memoryPatterns =
    confirmedPatterns > 0
      ? confirmedPatterns
      : Math.min(facts.length, 31);

  return (
    <div
      className="-mx-8 -mt-8 px-6 pt-6 pb-28 min-h-full font-sans bg-[#0f0f14]"
      style={{ color: C.primary }}
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8 animate-fade-in-up animate-delay-1">
        <div>
          <h1 className="text-[32px] font-semibold leading-tight text-white">
            Доброе утро{name ? `, ${name}` : ""}
          </h1>
          <p className="text-[14px] mt-2" style={{ color: C.muted }}>
            AIR4 уже всё проанализировал. Вот что важно сегодня.
          </p>
        </div>
        <p
          className="text-[14px] shrink-0 sm:text-right capitalize"
          style={{ color: C.muted }}
        >
          {dateLabel}
        </p>
      </div>

      {/* Top row */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-4">
        {/* AIRCH INTELLIGENCE */}
        <Card className="lg:col-span-3 min-h-[360px] animate-fade-in-up animate-delay-2">
          <span className={LABEL_CLASS}>AIRCH Intelligence</span>

          {recoLoading ? (
            <div className="flex flex-col lg:flex-row gap-6 flex-1 mt-5 animate-pulse">
              <div className="flex-[3] space-y-5">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="space-y-2">
                    <div className="h-3 w-32 rounded bg-white/10" />
                    <div className="h-12 w-full rounded bg-white/10" />
                  </div>
                ))}
              </div>
              <div className="flex-[2] space-y-3">
                {[1, 2].map((i) => (
                  <div key={i} className="h-16 rounded-xl bg-white/5" />
                ))}
              </div>
            </div>
          ) : recommendations ? (
            <div className="flex flex-col lg:flex-row gap-6 flex-1 mt-5">
              <button
                type="button"
                onClick={() =>
                  onOpenChatWithMessage(
                    buildPrimaryChatRequest(recommendations.primary),
                  )
                }
                className="flex-[3] min-w-0 text-left rounded-xl p-1 -m-1 hover:bg-white/[0.02] transition-colors group"
              >
                <div className="space-y-5">
                  <ThinkingSection
                    icon="👁"
                    label="ЧТО Я ВИЖУ"
                    text={recommendations.primary.sees}
                  />
                  <div className="border-t border-white/[0.06]" />
                  <ThinkingSection
                    icon="🧠"
                    label="ЧТО ЭТО ЗНАЧИТ"
                    text={recommendations.primary.understands}
                  />
                  <div className="border-t border-white/[0.06]" />
                  <ThinkingSection
                    icon="💡"
                    label="ЧТО ПРЕДЛАГАЮ"
                    text={recommendations.primary.suggests}
                  />
                </div>
                <span
                  className="inline-block mt-5 text-[11px] uppercase tracking-wide font-semibold px-2.5 py-1 rounded-full"
                  style={{
                    color: C.orange,
                    backgroundColor: "rgba(249,115,22,0.12)",
                  }}
                >
                  {DOMAIN_BADGE[recommendations.primary.domain]}
                </span>
              </button>

              <div className="flex-[2] flex flex-col gap-3 min-w-0">
                {recommendations.secondary.map((signal) => (
                  <button
                    key={signal.domain}
                    type="button"
                    onClick={() =>
                      onOpenChatWithMessage(buildSecondaryChatRequest(signal))
                    }
                    className="flex items-start gap-3 w-full text-left rounded-xl p-3 border border-white/[0.06] hover:border-[rgba(249,115,22,0.25)] hover:bg-white/[0.02] transition-colors group"
                  >
                    <div className="flex-1 min-w-0">
                      <p className={LABEL_CLASS}>
                        {DOMAIN_TILE_LABEL[signal.domain]}
                      </p>
                      <p
                        className="text-[13px] mt-2 leading-snug"
                        style={{ color: C.muted }}
                      >
                        {signal.one_line}
                      </p>
                    </div>
                    <span
                      className="text-[16px] shrink-0 pt-1 opacity-40 group-hover:opacity-100 transition-opacity"
                      style={{ color: C.muted }}
                    >
                      →
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className={`${META_LABEL_CLASS} mt-5`}>
              Не удалось загрузить анализ — попробуй обновить страницу.
            </p>
          )}
        </Card>

        {/* ФИНАНСЫ */}
        <Card
          className="lg:col-span-2 min-h-[300px] animate-fade-in-up animate-delay-2"
          onClick={
            financeSignal
              ? () =>
                  onOpenChatWithMessage(buildSecondaryChatRequest(financeSignal))
              : () => onPageChange("Finance")
          }
        >
          <div className="flex items-center justify-between mb-5">
            <span className={LABEL_CLASS}>Финансы</span>
            <DetailLink onClick={() => onPageChange("Finance")} />
          </div>

          <p className="text-[13px] mb-2" style={{ color: C.muted }}>
            Резервный фонд
          </p>
          <p className="text-[28px] font-semibold font-mono tabular-nums text-white leading-none">
            {currentSavings != null
              ? `${formatEuroDisplay(currentSavings)} / ${formatEuroDisplay(savingsTarget)}`
              : "—"}
          </p>
          <div className="mt-4">
            <ProgressBar pct={savingsPct} />
          </div>

          <div className="mt-6 space-y-2.5">
            <StatusDot
              color={incomeStable ? C.green : C.gray}
              label={
                incomeStable ? "Доход стабильный" : "Доход не зафиксирован"
              }
            />
            <StatusDot
              color={reserveBelowTarget ? C.orange : C.green}
              label={
                reserveBelowTarget ? "Запас ниже цели" : "Запас в норме"
              }
            />
            <StatusDot
              color={C.gray}
              label={`Подписок: ${activeSubsCount} активных`}
            />
          </div>
        </Card>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
        {/* ПРОЕКТЫ */}
        <Card
          className="min-h-[220px] animate-fade-in-up animate-delay-3"
          onClick={
            recommendations?.primary.domain === "projects"
              ? () =>
                  onOpenChatWithMessage(
                    buildPrimaryChatRequest(recommendations.primary),
                  )
              : projectsSignal
                ? () =>
                    onOpenChatWithMessage(
                      buildSecondaryChatRequest(projectsSignal),
                    )
                : () => onPageChange("Projects")
          }
        >
          <TileHeader
            label="Проекты"
            onDetail={() => onPageChange("Projects")}
          />

          {topProject ? (
            <div className="flex flex-col flex-1 min-h-0">
              <p className={`${METRIC_VALUE_CLASS} truncate`}>
                {topProject.name}
              </p>
              <div className="flex items-center gap-3 mt-2">
                <div className="flex-1">
                  <ProgressBar
                    pct={topProjectPct}
                    color={progressFillColor(topProjectPct)}
                  />
                </div>
                <span
                  className="text-[12px] font-semibold tabular-nums shrink-0"
                  style={{ color: progressFillColor(topProjectPct) }}
                >
                  {topProjectPct}%
                </span>
              </div>
              <p
                className={METRIC_CAPTION_CLASS}
                style={{
                  color: isToday(topProject.updated_at) ? C.orange : C.muted,
                }}
              >
                {formatProjectActivityLabel(topProject)}
              </p>
              <p className={META_LABEL_CLASS}>
                {activeProjects.length} активный
                {waitingProjects > 0 ? ` · ${waitingProjects} ожидают` : ""}
              </p>
              <p className={CARD_FOOTER_CLASS} style={{ color: C.orange }}>
                Продолжить {topProject.name} →
              </p>
            </div>
          ) : (
            <p className={META_LABEL_CLASS}>Нет активных проектов</p>
          )}
        </Card>

        {/* СПОРТ */}
        <Card
          className="min-h-[220px] animate-fade-in-up animate-delay-3"
          onClick={
            recommendations?.primary.domain === "health"
              ? () =>
                  onOpenChatWithMessage(
                    buildPrimaryChatRequest(recommendations.primary),
                  )
              : healthSignal
                ? () =>
                    onOpenChatWithMessage(
                      buildSecondaryChatRequest(healthSignal),
                    )
                : () => onPageChange("Sport")
          }
        >
          <TileHeader label="Спорт" onDetail={() => onPageChange("Sport")} />

          <div className="flex flex-col flex-1 min-h-0">
            <p className={META_LABEL_CLASS}>На этой неделе</p>
            <MetricValue suffix={`/ ${WEEK_GOAL}`}>{weekWorkouts}</MetricValue>
            <ProgressBar
              pct={Math.min(100, Math.round((weekWorkouts / WEEK_GOAL) * 100))}
              color={C.green}
              className="mt-2"
            />

            <p className={SECONDARY_LABEL_CLASS}>Следующая тренировка</p>
            <div className="flex items-center gap-2 min-w-0 text-[12px]">
              <Dumbbell size={14} style={{ color: C.orange }} className="shrink-0" />
              <p className="font-medium text-white truncate flex-1">
                {healthToday}
              </p>
              <span className="shrink-0" style={{ color: C.muted }}>
                Сегодня
              </span>
            </div>
          </div>
        </Card>

        {/* АКТИВНОСТЬ */}
        <Card
          className={`animate-fade-in-up animate-delay-3 ${
            observerHasData ? "min-h-[280px]" : "min-h-[220px]"
          }`}
          onClick={() => onPageChange("Observer")}
        >
          <TileHeader
            label="Активность сегодня"
            onDetail={() => onPageChange("Observer")}
          />

          {observerLoading ? (
            <div className="flex flex-col flex-1 animate-pulse space-y-3 mt-1">
              <div className="h-9 w-28 rounded bg-white/10" />
              {[1, 2, 3].map((i) => (
                <div key={i} className="space-y-1.5">
                  <div className="h-3 w-full rounded bg-white/10" />
                  <div className="h-1 w-full rounded bg-white/10" />
                </div>
              ))}
            </div>
          ) : !observerHasData ? (
            <p className={META_LABEL_CLASS}>Нет данных</p>
          ) : (
            <div className="flex flex-col flex-1 min-h-0">
              <MetricValue>
                {formatObserverDuration(observerToday?.total_minutes ?? 0)}
              </MetricValue>
              <div className="mt-4 space-y-2.5 flex-1">
                {observerApps.map((item) => {
                  const barPct = Math.round(
                    (item.total_minutes / observerMaxMinutes) * 100,
                  );
                  return (
                    <div
                      key={`${item.app}-${item.project ?? ""}`}
                      className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] items-center gap-2"
                    >
                      <span
                        className="text-[11px] truncate"
                        style={{ color: C.muted }}
                        title={formatObserverAppLabel(item)}
                      >
                        {formatObserverAppLabel(item)}
                      </span>
                      <div className="h-1 rounded-[2px] overflow-hidden bg-white/[0.08]">
                        <div
                          className="h-full rounded-[2px] transition-all duration-500"
                          style={{
                            width: `${barPct}%`,
                            backgroundColor: C.orange,
                          }}
                        />
                      </div>
                      <span
                        className="text-[11px] tabular-nums shrink-0 text-right"
                        style={{ color: C.muted }}
                      >
                        {formatObserverDuration(item.total_minutes)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Card>

        {/* ПАМЯТЬ */}
        <Card className="min-h-[220px] animate-fade-in-up animate-delay-4">
          <TileHeader
            label="Память"
            onDetail={() => onPageChange("Memory")}
            trailing={<Info size={13} style={{ color: C.muted }} />}
          />

          <div className="grid grid-cols-2 gap-4 flex-1">
            <div>
              <p className={METRIC_VALUE_CLASS}>{memoryEvents}</p>
              <p className={METRIC_CAPTION_CLASS}>события</p>
            </div>
            <div>
              <p className={METRIC_VALUE_CLASS}>{memoryPatterns}</p>
              <p className={METRIC_CAPTION_CLASS}>паттерн подтверждён</p>
            </div>
          </div>

          <p
            className={`${CARD_FOOTER_CLASS} flex items-center gap-1.5`}
            style={{ color: C.green }}
          >
            <span>✓</span>
            Система обучается на твоих данных
          </p>
        </Card>

        {/* ОТКРЫТО */}
        <Card className="min-h-[220px] animate-fade-in-up animate-delay-4">
          <TileHeader label="Открыто" onDetail={() => onPageChange("Memory")} />

          <div className="flex flex-col flex-1 min-h-0">
            <p className={METRIC_VALUE_CLASS}>{allOpenLoops.length}</p>
            <p className={METRIC_CAPTION_CLASS}>
              {pluralOpenQuestions(allOpenLoops.length)}
            </p>

            {allOpenLoops.length === 0 ? (
              <p className={`${META_LABEL_CLASS} mt-3`}>Всё под контролем</p>
            ) : (
              <div
                className="flex-1 min-h-0 overflow-y-auto space-y-2 mt-3 pr-0.5"
                style={{
                  maxHeight: allOpenLoops.length > 3 ? "4.5rem" : undefined,
                }}
              >
                {allOpenLoops.map((o) => {
                  const days = o.created_at ? daysSince(o.created_at) : 0;
                  return (
                    <div
                      key={o.id}
                      className="flex items-center gap-2 min-w-0 text-[12px]"
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ backgroundColor: C.gray }}
                      />
                      <p className="truncate flex-1 text-[#e2e8f0]">
                        {truncateChars(o.title, 36)}
                      </p>
                      <span
                        className="text-[10px] font-semibold tabular-nums shrink-0"
                        style={{ color: C.muted }}
                      >
                        {days}д
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {allOpenLoops.length > 3 && (
              <button
                type="button"
                onClick={() => onPageChange("Memory")}
                className={`${CARD_FOOTER_CLASS} text-left`}
                style={{ color: C.orange }}
              >
                Смотреть все →
              </button>
            )}
          </div>
        </Card>
      </div>

      {/* Chat bar */}
      <button
        type="button"
        onClick={() => onPageChange("Chat")}
        className="w-full rounded-[20px] px-6 py-4 border border-white/[0.06] flex items-center gap-4 text-left transition-[border-color] duration-200 hover:border-[rgba(249,115,22,0.3)] animate-fade-in-up animate-delay-5"
        style={{ backgroundColor: C.card }}
      >
        <Sparkles size={20} style={{ color: C.orange }} className="shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-semibold text-white">
            Чем займёмся?
          </p>
          <p className="text-[13px] mt-0.5" style={{ color: C.muted }}>
            Спроси AIR4 о чём угодно
          </p>
        </div>
        <span
          className="flex items-center justify-center w-10 h-10 rounded-full shrink-0"
          style={{ backgroundColor: "#ffffff", color: C.bg }}
        >
          <ArrowUp size={18} strokeWidth={2.5} />
        </span>
      </button>
    </div>
  );
}
