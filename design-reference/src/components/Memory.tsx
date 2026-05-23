import { useEffect, useMemo, useState } from "react";
import { Brain, Database, Sparkles } from "lucide-react";
import { fetchEvents, type LifeEvent } from "../lib/api";
import { domainIcon, formatDomainLabel } from "../lib/format";
import { cn } from "../lib/utils";
import { t } from "../lib/typography";
import { PageEmptyState } from "./PageEmptyState";

type DomainFilter = "all" | "finance" | "health" | "projects" | "life" | "personal";

const FILTERS: DomainFilter[] = ["all", "finance", "health", "projects", "life", "personal"];

// Russian labels for the filter chips. Keeps the underlying enum values
// in English so backend queries / persisted state stay unchanged.
const FILTER_LABELS: Record<DomainFilter, string> = {
  all: "все",
  finance: "финансы",
  health: "здоровье",
  projects: "проекты",
  life: "жизнь",
  personal: "личное",
};

const DOMAIN_BADGE: Record<string, string> = {
  health: "bg-emerald-50 text-emerald-700 border-emerald-100",
  finance: "bg-amber-50 text-amber-700 border-amber-100",
  projects: "bg-indigo-50 text-indigo-700 border-indigo-100",
  life: "bg-violet-50 text-violet-700 border-violet-100",
  personal: "bg-sky-50 text-sky-700 border-sky-100",
};

function groupEventsByDate(
  events: LifeEvent[]
): { date: string; items: LifeEvent[] }[] {
  const byDate = new Map<string, LifeEvent[]>();
  for (const event of events) {
    const d = event.date || "Без даты";
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push(event);
  }
  return [...byDate.keys()]
    .sort((a, b) => b.localeCompare(a))
    .map((date) => ({ date, items: byDate.get(date)! }));
}

export function Memory() {
  const [events, setEvents] = useState<LifeEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<DomainFilter>("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await fetchEvents();
        if (!cancelled) {
          setEvents(data.events);
          setTotal(data.total);
        }
      } catch {
        if (!cancelled) {
          setEvents([]);
          setTotal(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: events.length };
    for (const e of events) {
      map[e.domain] = (map[e.domain] ?? 0) + 1;
    }
    return map;
  }, [events]);

  const filtered = useMemo(
    () => (filter === "all" ? events : events.filter((e) => e.domain === filter)),
    [events, filter]
  );

  const grouped = useMemo(() => groupEventsByDate(filtered), [filtered]);

  const header = (
    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
      <div className="flex items-center gap-2.5">
        <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
          <Brain size={22} className="fill-blue-100" />
        </div>
        <div>
          <h1 className={t.pageTitle}>
            Архив памяти
          </h1>
          <p className={cn(t.pageSub, "mt-0.5")}>
            События, milestone-ы и жизненный контекст
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 bg-blue-50/50 border border-blue-100 px-3.5 py-1.5 rounded-xl">
        <Sparkles size={14} className="text-blue-600" />
        <span className="text-xs font-bold text-blue-700">Движок памяти</span>
      </div>
    </div>
  );

  const filterBar = (
    <div className="flex flex-wrap items-center gap-2">
      {FILTERS.map((f) => {
        const active = filter === f;
        const count = counts[f] ?? 0;
        const disabled = f !== "all" && count === 0;
        return (
          <button
            key={f}
            type="button"
            onClick={() => !disabled && setFilter(f)}
            disabled={disabled}
            className={cn(
              "px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest transition-colors inline-flex items-center gap-2",
              active
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-500/20"
                : "bg-white text-gray-500 border border-gray-100 hover:text-gray-900 hover:border-gray-200",
              disabled && "opacity-40 cursor-not-allowed hover:text-gray-500"
            )}
          >
            <span>{FILTER_LABELS[f]}</span>
            <span
              className={cn(
                "font-mono text-[9px]",
                active ? "text-white/80" : "text-gray-400"
              )}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );

  if (loading) {
    return (
      <div className="flex flex-col gap-8 pb-10">
        {header}
        <p className="text-[14px] text-[#9ca3af]">Загрузка…</p>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-col gap-8 pb-10">
        {header}
        <PageEmptyState
          icon={Database}
          title="Воспоминаний пока нет"
          subtext="Начните диалог с AIR4 — ваши воспоминания появятся здесь."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 pb-10">
      {header}
      {filterBar}

      {grouped.length === 0 ? (
        <p className="text-[13px] text-[#9ca3af] py-8 text-center">
          В этой области пока нет событий.
        </p>
      ) : (
        <div className="space-y-6">
          {grouped.map(({ date, items }) => (
            <section key={date}>
              <h2 className="text-[10px] font-bold text-[#9ca3af] uppercase tracking-[0.18em] mb-3">
                {date}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {items.map((event) => (
                  <article
                    key={event.id}
                    className="bg-white rounded-2xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.05)] flex gap-3"
                  >
                    <div
                      className="w-9 h-9 rounded-xl bg-gray-50 flex items-center justify-center text-base shrink-0"
                      aria-hidden
                    >
                      {domainIcon(event.domain)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2 mb-1">
                        <h3 className="text-[14px] font-bold text-gray-900 leading-snug">
                          {event.title}
                        </h3>
                        <span
                          className={cn(
                            "text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-tight border shrink-0",
                            DOMAIN_BADGE[event.domain] ??
                              "bg-gray-50 text-gray-600 border-gray-100"
                          )}
                        >
                          {formatDomainLabel(event.domain)}
                        </span>
                      </div>
                      {event.description && (
                        <p className="text-[12.5px] text-gray-600 leading-snug mb-1.5 line-clamp-3">
                          {event.description}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-2 text-[10.5px] text-[#9ca3af] font-medium">
                        <span>{event.date}</span>
                        {event.category && (
                          <span className="font-mono uppercase tracking-wide">
                            {event.category.replace(/_/g, " ")}
                          </span>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {filter === "all" && total > events.length && (
        <p className="text-[12px] text-center text-[#9ca3af]">
          Показаны последние{" "}
          <span className="font-mono">{events.length}</span> из{" "}
          <span className="font-mono">{total}</span> событий
        </p>
      )}
    </div>
  );
}
