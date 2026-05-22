import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { Bell, Plus, Sparkles, Target } from "lucide-react";
import { cn } from "../lib/utils";
import { t as ty } from "../lib/typography";
import type { GoalItem } from "../lib/api";

type Props = {
  goals: GoalItem[];
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
  { progress: 60, color: "bg-indigo-600", label: "НА ПУТИ", status: "indigo" },
  { progress: 30, color: "bg-amber-500", label: "ОТСТАЁТ", status: "amber", alert: true },
  { progress: 40, color: "bg-red-500", label: "ТРЕБУЕТ ВНИМАНИЯ", status: "red" },
  { progress: 17, color: "bg-gray-400", label: "НЕ НАЧАТО", status: "gray" },
];

function goalInfo(goal: GoalItem): string {
  if (goal.source === "facts" && goal.key) {
    return `из ${goal.key.replace(/_/g, " ")}`;
  }
  return goal.source === "profile" ? "из профиля" : `источник: ${goal.source}`;
}

export function Goals({ goals }: Props) {
  const [showAddHint, setShowAddHint] = useState(false);

  useEffect(() => {
    if (!showAddHint) return;
    const t = window.setTimeout(() => setShowAddHint(false), 3500);
    return () => window.clearTimeout(t);
  }, [showAddHint]);

  const activeGoals = useMemo(
    () =>
      goals.map((goal, i) => {
        const tpl = GOAL_TEMPLATES[i % GOAL_TEMPLATES.length];
        return {
          key: `${goal.source}-${goal.id}-${goal.key ?? ""}`,
          title: goal.title,
          info: goalInfo(goal),
          ...tpl,
        };
      }),
    [goals]
  );

  return (
    <div className="flex flex-col gap-8 pb-10">
      {/* Banner */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-green-50 text-green-600 rounded-xl">
            <Target size={22} className="fill-green-100" />
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
          <div className="flex items-center gap-2 bg-green-50/50 border border-green-100 px-3.5 py-1.5 rounded-xl">
            <Sparkles size={14} className="text-green-600" />
            <span className="text-xs font-bold text-green-700">Жизненный советник</span>
          </div>

          <button
            type="button"
            onClick={() => setShowAddHint(true)}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl font-bold text-[12px] shadow-md shadow-indigo-500/20 transition-all uppercase tracking-wider"
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
          className="text-[12px] text-indigo-600 font-medium bg-indigo-50 border border-indigo-100 px-4 py-2 rounded-xl -mt-4"
        >
          Расскажите AIR4 о цели в чате — она появится здесь.
        </motion.p>
      )}

      <div className="grid grid-cols-5 gap-6">
        {/* Left Column */}
        <div className="col-span-3 space-y-6">
          {/* Active Goals Grid */}
          {activeGoals.length === 0 ? (
            <div className="bg-white rounded-[20px] p-8 shadow-[0_2px_12px_rgba(0,0,0,0.08)] text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-green-50 text-green-600 mb-3">
                <Target size={22} />
              </div>
              <p className="text-[14px] font-bold text-gray-700">
                Целей пока нет
              </p>
              <p className="text-[12px] text-gray-400 mt-1">
                Расскажите AIR4 о своих целях в чате — они появятся здесь.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {activeGoals.map((g, i) => (
                <div
                  key={g.key}
                  className="bg-white rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)] relative overflow-hidden group"
                >
                  <div
                    className={cn(
                      "absolute top-4 left-4 w-2 h-2 rounded-full",
                      g.status === "indigo"
                        ? "bg-indigo-500"
                        : g.status === "amber"
                          ? "bg-amber-500"
                          : g.status === "red"
                            ? "bg-red-500"
                            : "bg-gray-400"
                    )}
                  />
                  <div className="pl-6">
                    <div className="flex justify-between items-start mb-4 gap-2">
                      <h3 className="text-[16px] font-bold text-gray-900 leading-snug">
                        {g.title}
                      </h3>
                      {g.alert && (
                        <span className="bg-red-50 text-red-500 text-[10px] font-bold px-1.5 py-0.5 rounded tracking-tighter shrink-0">
                          ОТСТАЁТ
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] text-gray-400 font-medium mb-6 uppercase tracking-wide">
                      {g.info}
                    </p>
                    <div className="space-y-2">
                      <div className="h-1 w-full bg-gray-50 rounded-full overflow-hidden">
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
                          g.status === "red" ? "text-red-500" : "text-gray-400"
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
          <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
            <h2 className={cn(ty.cardLabel, "mb-6")}>
              Список желаний
            </h2>
            <div className="bg-gray-50/50 border border-dashed border-gray-200 rounded-2xl p-6 text-center">
              <p className="text-[13px] font-medium text-gray-500">
                Список желаний пуст.
              </p>
              <p className="text-[12px] text-gray-400 mt-1">
                Расскажите AIR4 о своих желаниях в чате.
              </p>
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="col-span-2 space-y-6">
          {/* AIR4 Observation (hardcoded) */}
          <div className="bg-[#1a1a2e] rounded-[20px] p-6 shadow-xl border-l-[6px] border-indigo-500">
            <div className="flex gap-3 text-white">
              <div className="shrink-0 w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center">
                <Bell size={16} />
              </div>
              <p className="text-[15px] leading-relaxed font-medium">
                «Отстаёте по 50% целей.{" "}
                <span className="text-amber-400 font-bold">Цель по книгам</span>{" "}
                в текущем темпе — провал. 1 книга в 3 недели или признайте,
                что это была цель для галочки.»
              </p>
            </div>
          </div>

          {/* Deadlines (hardcoded) */}
          <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
            <h2 className={cn(ty.cardLabel, "mb-6")}>
              Дедлайны
            </h2>
            <div className="relative pl-6 space-y-8 before:absolute before:left-0 before:top-2 before:bottom-2 before:w-px before:bg-gray-100">
              {[
                { date: "Дек 2024", name: "10 книг", color: "bg-amber-500" },
                { date: "Мар 2025", name: "Запуск AIR4", color: "bg-indigo-600" },
                { date: "Июн 2025", name: "Поездка в Японию", color: "bg-gray-400" },
                { date: "Без даты", name: "Цель по % жира", color: "bg-red-500" },
              ].map((t, i) => (
                <div key={i} className="relative">
                  <div
                    className={cn(
                      "absolute -left-[27px] top-1.5 w-1.5 h-1.5 rounded-full ring-4 ring-white",
                      t.color
                    )}
                  />
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                    {t.date}
                  </p>
                  <p className="text-[14px] font-bold text-gray-900 mt-0.5">{t.name}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Weekly Focus (hardcoded) */}
          <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)] relative">
            <h2 className={cn(ty.cardLabel, "mb-6")}>
              Фокус недели
            </h2>
            <p className="text-[14px] leading-relaxed text-gray-600 mb-6 font-medium">
              «Без отговорок:{" "}
              <span className="text-indigo-600 font-bold">AIR4 milestone #4</span>{" "}
              и 2 главы. Больше ничего не важно.»
            </p>
            <ul className="space-y-4">
              {[
                { text: "AIR4 milestone #4" },
                { text: "Прочитать 2 главы" },
              ].map((item, i) => (
                <li
                  key={i}
                  className="flex items-center gap-3 bg-indigo-50/30 p-3 rounded-xl border border-indigo-100/30"
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
                  <span className="text-[13px] font-bold text-indigo-900">{item.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
