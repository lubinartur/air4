import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Eye } from "lucide-react";
import {
  fetchObserverLog,
  fetchObserverStatus,
  fetchObserverToday,
  toggleObserver,
  type ObserverEvent,
  type ObserverToday,
} from "../lib/api";
import { cn } from "../lib/utils";

const APP_EMOJI: Record<string, string> = {
  Cursor: "💻",
  Code: "💻",
  Figma: "🎨",
  Sketch: "🎨",
  Chrome: "🌐",
  Safari: "🌐",
  Firefox: "🌐",
  Terminal: "⌨️",
  Xcode: "🔨",
  Telegram: "✈️",
  Slack: "💬",
  Mail: "📧",
  WhatsApp: "💬",
  Notes: "📝",
  Notion: "📓",
  Bear: "🐻",
  Obsidian: "💎",
};

function appEmoji(app: string): string {
  return APP_EMOJI[app] ?? "📱";
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}мин`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}ч ${m}мин` : `${h}ч`;
}

function localDateKey(value: Date | string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) {
    return (typeof value === "string" ? value : "").slice(0, 10) || "unknown";
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDateLabel(isoDate: string): string {
  const today = localDateKey(new Date());
  const yesterday = localDateKey(new Date(Date.now() - 86400000));
  if (isoDate === today) return "Сегодня";
  if (isoDate === yesterday) return "Вчера";
  const [y, m, d] = isoDate.split("-");
  return `${d}.${m}.${y}`;
}

function groupLogByDay(events: ObserverEvent[]): { date: string; minutes: number }[] {
  const byDay = new Map<string, number>();
  for (const e of events) {
    const raw = e.observed_at || "";
    if (!raw) continue;
    const date = localDateKey(raw);
    byDay.set(date, (byDay.get(date) ?? 0) + Math.floor(e.duration_seconds / 60));
  }
  return [...byDay.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, minutes]) => ({ date, minutes }));
}

function ObserverToggle({
  enabled,
  onChange,
  disabled,
}: {
  enabled: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!enabled)}
      className={cn(
        "w-10 h-5 rounded-full relative transition-all shrink-0",
        enabled ? "bg-[#22c55e]" : "bg-white/10",
        disabled && "opacity-50 cursor-not-allowed",
      )}
      aria-label={enabled ? "Наблюдение включено" : "Наблюдение выключено"}
    >
      <div
        className={cn(
          "absolute top-1 w-3 h-3 rounded-full bg-white transition-all shadow-sm",
          enabled ? "left-6" : "left-1",
        )}
      />
    </button>
  );
}

export function ObserverPage() {
  const [enabled, setEnabled] = useState(true);
  const [running, setRunning] = useState(false);
  const [today, setToday] = useState<ObserverToday | null>(null);
  const [history, setHistory] = useState<ObserverEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const [status, todayData, log] = await Promise.all([
        fetchObserverStatus(),
        fetchObserverToday(),
        fetchObserverLog(7, 200),
      ]);
      setEnabled(status.enabled);
      setRunning(status.running);
      setToday(todayData);
      setHistory(log);
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  const handleToggle = async (next: boolean) => {
    setToggling(true);
    try {
      const res = await toggleObserver(next);
      setEnabled(res.enabled);
      const status = await fetchObserverStatus();
      setRunning(status.running);
    } catch {
      /* keep previous state */
    } finally {
      setToggling(false);
    }
  };

  const byProject = useMemo(() => {
    const items = today?.by_app_aggregated ?? [];
    if (!items.length) return [];
    const map = new Map<string, { minutes: number; apps: Set<string> }>();
    for (const item of items) {
      const hint = item.project?.trim();
      if (!hint) continue;
      const cur = map.get(hint) ?? { minutes: 0, apps: new Set<string>() };
      cur.minutes += item.total_minutes;
      cur.apps.add(item.app);
      map.set(hint, cur);
    }
    return [...map.entries()]
      .sort((a, b) => b[1].minutes - a[1].minutes)
      .map(([project, data]) => ({
        project,
        minutes: data.minutes,
        apps: [...data.apps].join(", "),
      }));
  }, [today]);

  const todayAggregated = today?.by_app_aggregated ?? [];
  const maxTodayMinutes = useMemo(
    () => Math.max(1, ...todayAggregated.map((item) => item.total_minutes)),
    [todayAggregated],
  );

  const historyByDay = useMemo(() => {
    const todayLocal = localDateKey(new Date());
    return groupLogByDay(history).filter((day) => day.date !== todayLocal);
  }, [history]);

  const toggleDay = (date: string) => {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-8 pb-10">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-white/5 text-[#cbd5e1] rounded-xl">
            <Eye size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-black text-[#f1f5f9] tracking-tight">
              Наблюдения
            </h1>
            <p className="text-[11px] font-bold text-[#94a3b8] uppercase tracking-widest mt-0.5">
              Активность на macOS
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-sm font-bold text-[#94a3b8]">
            сегодня {today?.total_minutes ?? 0} мин
          </span>
          <div className="flex items-center gap-2 bg-white/5 border border-white/5 px-3 py-1.5 rounded-xl">
            <span
              className={cn(
                "w-2 h-2 rounded-full",
                running
                  ? "bg-[#22c55e] animate-pulse"
                  : enabled
                    ? "bg-[#eab308]"
                    : "bg-white/20",
              )}
            />
            <span className="text-xs font-bold text-[#cbd5e1]">
              {running ? "Активен" : enabled ? "Включён" : "Выключен"}
            </span>
            <ObserverToggle
              enabled={enabled}
              onChange={handleToggle}
              disabled={toggling}
            />
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-[#94a3b8] text-sm">Загрузка…</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="bg-[#13131f] rounded-[20px] p-6 border border-white/5">
            <h2 className="text-[11px] font-bold text-[#94a3b8] uppercase tracking-[0.1em] mb-6">
              Сегодня
            </h2>
            {!todayAggregated.length ? (
              <p className="text-sm text-[#64748b]">
                Пока нет записей. Сессии от 1 минуты в отслеживаемых приложениях.
              </p>
            ) : (
              <div className="space-y-4">
                {todayAggregated.map((item) => {
                  const barPct = Math.round(
                    (item.total_minutes / maxTodayMinutes) * 100,
                  );
                  const label = item.project
                    ? `${item.app} · ${item.project}`
                    : item.app;
                  return (
                    <div key={`${item.app}-${item.project ?? ""}`}>
                      <div className="flex items-center justify-between gap-3 mb-1.5">
                        <p className="text-[14px] font-bold text-[#f1f5f9] truncate">
                          <span className="mr-1.5">{appEmoji(item.app)}</span>
                          {label}
                        </p>
                        <span className="text-[13px] font-bold text-[#cbd5e1] shrink-0">
                          {formatDuration(item.total_minutes)}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[#f97316] transition-all"
                          style={{ width: `${barPct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {byProject.length > 0 && (
            <section className="bg-[#13131f] rounded-[20px] p-6 border border-white/5">
              <h2 className="text-[11px] font-bold text-[#94a3b8] uppercase tracking-[0.1em] mb-6">
                По проектам
              </h2>
              <div className="space-y-3">
                {byProject.map((row) => (
                  <div
                    key={row.project}
                    className="flex justify-between items-baseline py-2 border-b border-white/5 last:border-0"
                  >
                    <div>
                      <p className="text-[14px] font-bold text-[#f1f5f9]">
                        {row.project}
                      </p>
                      <p className="text-[11px] text-[#64748b]">{row.apps}</p>
                    </div>
                    <span className="text-[13px] font-bold text-[#cbd5e1]">
                      {formatDuration(row.minutes)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section
            className={cn(
              "bg-[#13131f] rounded-[20px] p-6 border border-white/5",
              byProject.length > 0 ? "lg:col-span-2" : "",
            )}
          >
            <h2 className="text-[11px] font-bold text-[#94a3b8] uppercase tracking-[0.1em] mb-6">
              История
            </h2>
            {!historyByDay.length ? (
              <p className="text-sm text-[#64748b]">Нет данных за последние 7 дней.</p>
            ) : (
              <div className="space-y-2">
                {historyByDay.map((day) => {
                  const open = expandedDays.has(day.date);
                  const dayEvents = history.filter(
                    (e) => localDateKey(e.observed_at || "") === day.date,
                  );
                  return (
                    <div
                      key={day.date}
                      className="rounded-xl border border-white/5 overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() => toggleDay(day.date)}
                        className="w-full flex items-center justify-between px-4 py-3 bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
                      >
                        <span className="text-[14px] font-bold text-[#cbd5e1]">
                          {formatDateLabel(day.date)}
                        </span>
                        <div className="flex items-center gap-3">
                          <span className="text-[13px] text-[#94a3b8]">
                            {formatDuration(day.minutes)}
                          </span>
                          <ChevronDown
                            size={16}
                            className={cn(
                              "text-[#64748b] transition-transform",
                              open && "rotate-180",
                            )}
                          />
                        </div>
                      </button>
                      {open && (
                        <div className="px-4 py-2 border-t border-white/5 space-y-2">
                          {dayEvents.map((e) => (
                            <div
                              key={e.id}
                              className="flex justify-between text-[12px] py-1"
                            >
                              <span className="text-[#94a3b8]">
                                {appEmoji(e.app_name)} {e.app_name}
                                {e.project_hint ? ` · ${e.project_hint}` : ""}
                              </span>
                              <span className="text-[#cbd5e1] font-medium">
                                {formatDuration(Math.floor(e.duration_seconds / 60))}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

export default ObserverPage;
