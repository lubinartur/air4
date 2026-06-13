import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { Briefcase, Plus, Target } from "lucide-react";
import { cn } from "../lib/utils";
import { t as ty } from "../lib/typography";
import { fetchProjects, type GoalItem, type Project } from "../lib/api";
import type { Page } from "../types";

type Props = {
  goals: GoalItem[];
  /** Lets project pills jump to the Projects page. Optional so the
   *  page works in storybook-style harnesses that don't carry the
   *  page-router state. */
  onNavigate?: (page: Page) => void;
};

type GoalTemplate = {
  progress: number;
  color: string;
  label: string;
  status: "indigo" | "amber" | "red" | "gray";
  alert?: boolean;
};

// Hardcoded visual templates until the API exposes per-goal progress.
const GOAL_TEMPLATES: GoalTemplate[] = [
  { progress: 60, color: "bg-[#f97316]", label: "НА ПУТИ", status: "indigo" },
  { progress: 30, color: "bg-amber-500", label: "ОТСТАЁТ", status: "amber", alert: true },
  { progress: 40, color: "bg-red-500", label: "ТРЕБУЕТ ВНИМАНИЯ", status: "red" },
  { progress: 17, color: "bg-gray-400", label: "НЕ НАЧАТО", status: "gray" },
];

function goalInfo(goal: GoalItem): string {
  // Profile-derived goals get a friendly Russian label. Fact/other sources
  // carry raw technical keys (e.g. "fitness_goal_muscle_gain") that don't
  // read well in Russian, so they're hidden rather than shown verbatim.
  return goal.source === "profile" ? "из профиля" : "";
}

export function Goals({ goals, onNavigate }: Props) {
  const [showAddHint, setShowAddHint] = useState(false);
  // Projects are fetched lazily on mount because the global App
  // state already holds them but doesn't currently pipe them to
  // Goals. Loading directly keeps this change scoped and avoids
  // touching `App.tsx` for a derived view.
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    if (!showAddHint) return;
    const t = window.setTimeout(() => setShowAddHint(false), 3500);
    return () => window.clearTimeout(t);
  }, [showAddHint]);

  useEffect(() => {
    let cancelled = false;
    void fetchProjects()
      .then((data) => {
        if (!cancelled) setProjects(data);
      })
      .catch(() => {
        if (!cancelled) setProjects([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Reverse-index: `goal_key → projects linking to it`. Built once
  // per change to either projects or goals so each card can look up
  // its linked projects in O(1) below.
  const projectsByGoalKey = useMemo(() => {
    const map = new Map<string, Project[]>();
    for (const project of projects) {
      for (const key of project.goal_keys ?? []) {
        if (!key) continue;
        const bucket = map.get(key);
        if (bucket) bucket.push(project);
        else map.set(key, [project]);
      }
    }
    return map;
  }, [projects]);

  const activeGoals = useMemo(
    () =>
      goals.map((goal, i) => {
        const tpl = GOAL_TEMPLATES[i % GOAL_TEMPLATES.length];
        const goalKey = goal.key ?? "";
        return {
          key: `${goal.source}-${goal.id}-${goalKey}`,
          title: goal.title,
          info: goalInfo(goal),
          linkedProjects: goalKey
            ? projectsByGoalKey.get(goalKey) ?? []
            : [],
          ...tpl,
        };
      }),
    [goals, projectsByGoalKey]
  );

  return (
    <div className="flex flex-col gap-8 pb-10">
      {/* Banner */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 animate-fade-in-up animate-delay-1">
        <div className="flex items-center gap-2.5">
          <div className="p-2.5 bg-[#f97316]/15 border border-[#f97316]/30 text-[#f97316] rounded-xl">
            <Target size={22} />
          </div>
          <div>
            <h1 className={ty.pageTitle}>
              Жизненные цели
            </h1>
            <p className={cn(ty.pageSub, "mt-0.5")}>
              Личные ориентиры и трекинг прогресса
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => setShowAddHint(true)}
            className="flex items-center gap-2 bg-[#f97316] hover:bg-[#ea6a06] text-white px-4 py-2 rounded-xl font-bold text-[12px] shadow-md shadow-[#f97316]/20 transition-all uppercase tracking-wider"
          >
            <Plus size={14} />
            Добавить цель
          </button>
        </div>
      </div>

      {showAddHint && (
        <motion.p
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-[12px] text-[#f97316] font-medium bg-[#f97316]/15 border border-[#f97316]/30 px-4 py-2 rounded-xl -mt-4"
        >
          Расскажите AIR4 о цели в чате — она появится здесь.
        </motion.p>
      )}

      <div className="grid grid-cols-5 gap-6">
        {/* Left Column */}
        <div className="col-span-3 space-y-6">
          {/* Active Goals Grid */}
          {activeGoals.length === 0 ? (
            <div className="bg-[#13131f] rounded-[20px] p-8 shadow-[0_2px_12px_rgba(0,0,0,0.08)] text-center card-hover animate-fade-in-up animate-delay-2">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-green-50 text-green-600 mb-3">
                <Target size={22} />
              </div>
              <p className="text-[14px] font-bold text-[#cbd5e1]">
                Целей пока нет
              </p>
              <p className="text-[12px] text-[#94a3b8] mt-1">
                Расскажите AIR4 о своих целях в чате — они появятся здесь.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {activeGoals.map((g, i) => (
                <div
                  key={g.key}
                  className="bg-[#13131f] rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)] relative overflow-hidden group card-hover"
                >
                  <div
                    className={cn(
                      "absolute top-4 left-4 w-2 h-2 rounded-full",
                      g.status === "indigo"
                        ? "bg-[#f97316]"
                        : g.status === "amber"
                          ? "bg-amber-500"
                          : g.status === "red"
                            ? "bg-red-500"
                            : "bg-gray-400"
                    )}
                  />
                  <div className="pl-6">
                    <div className="flex justify-between items-start mb-4 gap-2">
                      <h3 className="text-[16px] font-bold text-[#f1f5f9] leading-snug">
                        {g.title}
                      </h3>
                    </div>
                    {g.info && (
                      <p className="text-[12px] text-[#94a3b8] font-medium mb-3 uppercase tracking-wide">
                        {g.info}
                      </p>
                    )}
                    {/* Linked projects block — collapses entirely
                        when no projects reference this goal so the
                        card height stays consistent for unlinked
                        goals. */}
                    {g.linkedProjects.length > 0 && (
                      <div className="mb-5 space-y-1.5">
                        <p className="text-[10px] font-black text-[#94a3b8] uppercase tracking-widest flex items-center gap-1">
                          <Briefcase size={10} />
                          Активные проекты
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {g.linkedProjects.map((project) => (
                            <button
                              key={project.id}
                              type="button"
                              onClick={() => onNavigate?.("Projects")}
                              title={`Перейти к проектам · ${project.name}`}
                              className={cn(
                                "inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full",
                                "bg-[#f97316]/15 border border-[#f97316]/30 text-[#f97316]",
                                "hover:bg-[#f97316]/10 hover:border-[#f97316]/30 transition-colors"
                              )}
                            >
                              <span
                                className={cn(
                                  "w-1.5 h-1.5 rounded-full shrink-0",
                                  project.status === "active"
                                    ? "bg-[#f97316]"
                                    : project.status === "stalled"
                                      ? "bg-red-400"
                                      : "bg-gray-300"
                                )}
                              />
                              <span className="truncate max-w-[140px]">
                                {project.name}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="space-y-2">
                      <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${g.progress}%` }}
                          transition={{ duration: 1, delay: i * 0.1 }}
                          className={cn(
                            "h-full rounded-full transition-all duration-500",
                            g.color
                          )}
                        />
                      </div>
                      <p
                        className={cn(
                          "text-[10px] font-bold uppercase tracking-wider",
                          g.status === "red" ? "text-red-500" : "text-[#94a3b8]"
                        )}
                      >
                        {g.label}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Wishlist */}
          <div className="bg-[#13131f] rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)] card-hover animate-fade-in-up animate-delay-3">
            <h2 className="text-lg font-extrabold text-[#f1f5f9] mb-6">
              Список желаний
            </h2>
            <div className="bg-white/5 border border-dashed border-white/5 rounded-2xl p-6 text-center">
              <p className="text-[13px] font-medium text-[#94a3b8]">
                Список желаний пуст.
              </p>
              <p className="text-[12px] text-[#94a3b8] mt-1">
                Расскажите AIR4 о своих желаниях в чате.
              </p>
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="col-span-2 space-y-6">
          {/* AIR4 Observation — unified indigo-card variant shared
              across pages. The inline amber highlight on «Цель по
              книгам» is preserved for narrative emphasis. */}
          <div className="relative overflow-hidden bg-[linear-gradient(135deg,#1a0a00_0%,#0f0f14_100%)] border border-[#f97316]/30 rounded-2xl p-5 shadow-xl card-hover animate-fade-in-up animate-delay-4">
            <Target
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
                  Цели
                </span>
              </div>
              <p className="text-[14px] font-medium text-white leading-relaxed pr-12">
                «Отстаёте по 50% целей.{" "}
                <span className="text-amber-300 font-bold">Цель по книгам</span>{" "}
                в текущем темпе — провал. 1 книга в 3 недели или признайте,
                что это была цель для галочки.»
              </p>
            </div>
          </div>

          {/* Deadlines (hardcoded) */}
          <div className="bg-[#13131f] rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)] card-hover animate-fade-in-up animate-delay-5">
            <h2 className="text-lg font-extrabold text-[#f1f5f9] mb-6">
              Дедлайны
            </h2>
            <div className="relative pl-6 space-y-8 before:absolute before:left-0 before:top-2 before:bottom-2 before:w-px before:bg-white/5">
              {[
                { date: "Дек 2024", name: "10 книг", color: "bg-amber-500" },
                { date: "Мар 2025", name: "Запуск AIR4", color: "bg-[#f97316]" },
                { date: "Июн 2025", name: "Поездка в Японию", color: "bg-gray-400" },
                { date: "Без даты", name: "Цель по % жира", color: "bg-red-500" },
              ].map((t, i) => (
                <div key={i} className="relative">
                  <div
                    className={cn(
                      "absolute -left-[27px] top-1.5 w-1.5 h-1.5 rounded-full ring-4 ring-[#13131f]",
                      t.color
                    )}
                  />
                  <p className="text-[10px] font-bold text-[#94a3b8] uppercase tracking-widest">
                    {t.date}
                  </p>
                  <p className="text-[14px] font-bold text-[#f1f5f9] mt-0.5">{t.name}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Weekly Focus (hardcoded) */}
          <div className="bg-[#13131f] rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)] relative card-hover animate-fade-in-up animate-delay-5">
            <h2 className="text-lg font-extrabold text-[#f1f5f9] mb-6">
              Фокус недели
            </h2>
            <p className="text-[14px] leading-relaxed text-[#cbd5e1] mb-6 font-medium">
              «Без отговорок:{" "}
              <span className="text-[#f97316] font-bold">AIR4 milestone #4</span>{" "}
              и 2 главы. Больше ничего не важно.»
            </p>
            <ul className="space-y-4">
              {[
                { text: "AIR4 milestone #4" },
                { text: "Прочитать 2 главы" },
              ].map((item, i) => (
                <li
                  key={i}
                  className="flex items-center gap-3 bg-[#f97316]/15 p-3 rounded-xl border border-[#f97316]/30"
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-[#f97316] shrink-0" />
                  <span className="text-[13px] font-bold text-[#f97316]">{item.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
