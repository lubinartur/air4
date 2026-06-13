import { useEffect, useMemo, useState } from "react";
import { Brain, Database } from "lucide-react";
import { fetchEvents, type LifeEvent } from "../lib/api";
import { domainIcon } from "../lib/format";
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

const DOMAIN_BADGE: Record<string, { label: string; className: string }> = {
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
  personal: {
    label: "ЛИЧНОЕ",
    className: "bg-[#ec4899]/15 text-[#ec4899] border-[#ec4899]/30",
  },
};

// Russian labels for event "type" (stored in event.category). Unknown
// categories fall back to their raw value, spaced + uppercased.
const EVENT_TYPE_LABELS: Record<string, string> = {
  milestone: "ВЕХА",
  goal: "ЦЕЛЬ",
  workout: "ТРЕНИРОВКА",
  event: "СОБЫТИЕ",
};

function eventTypeLabel(category: string): string {
  return (
    EVENT_TYPE_LABELS[(category || "").toLowerCase()] ??
    category.replace(/_/g, " ").toUpperCase()
  );
}

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
        <div className="p-2 bg-[#f97316]/15 text-[#f97316] rounded-xl">
          <Brain size={22} className="fill-[#f97316]/20" />
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
                ? "bg-[#f97316] text-white shadow-md shadow-[#f97316]/20"
                : "bg-white/5 text-[#94a3b8] border border-white/10 hover:text-[#f1f5f9] hover:border-white/20",
              disabled && "opacity-40 cursor-not-allowed hover:text-[#94a3b8]"
            )}
          >
            <span>{FILTER_LABELS[f]}</span>
            <span
              className={cn(
                "font-mono text-[9px]",
                active ? "text-white/80" : "text-[#94a3b8]"
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
        <p className="text-[14px] text-[#94a3b8]">Загрузка…</p>
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
        <p className="text-[13px] text-[#94a3b8] py-8 text-center">
          В этой области пока нет событий.
        </p>
      ) : (
        <div className="space-y-6">
          {grouped.map(({ date, items }) => (
            <section key={date}>
              <h2 className="text-[10px] font-bold text-[#94a3b8] uppercase tracking-[0.18em] mb-3">
                {date}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {items.map((event) => (
                  <article
                    key={event.id}
                    className="bg-[#13131f] rounded-2xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.05)] flex gap-3"
                  >
                    <div
                      className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center text-base shrink-0"
                      aria-hidden
                    >
                      {domainIcon(event.domain)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2 mb-1">
                        <h3 className="text-[14px] font-bold text-[#f1f5f9] leading-snug">
                          {event.title}
                        </h3>
                        {(() => {
                          const badge = DOMAIN_BADGE[event.domain] ?? {
                            label: event.domain.replace(/_/g, " ").toUpperCase(),
                            className: "bg-white/5 text-[#cbd5e1] border-white/5",
                          };
                          return (
                            <span
                              className={cn(
                                "text-[9px] font-bold px-1.5 py-0.5 rounded-md uppercase tracking-tight border shrink-0",
                                badge.className
                              )}
                            >
                              {badge.label}
                            </span>
                          );
                        })()}
                      </div>
                      {event.description && (
                        <p className="text-[12.5px] text-[#cbd5e1] leading-snug mb-1.5 line-clamp-3">
                          {event.description}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-2 text-[10.5px] text-[#94a3b8] font-medium">
                        <span>{event.date}</span>
                        {event.category && (
                          <span className="text-[9px] font-bold uppercase tracking-tight px-1.5 py-0.5 rounded-md bg-white/5 text-[#64748b]">
                            {eventTypeLabel(event.category)}
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
        <p className="text-[12px] text-center text-[#94a3b8]">
          Показаны последние{" "}
          <span className="font-mono">{events.length}</span> из{" "}
          <span className="font-mono">{total}</span> событий
        </p>
      )}
    </div>
  );
}
