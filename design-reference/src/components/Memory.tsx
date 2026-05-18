import { useEffect, useMemo, useState } from "react";
import { Database } from "lucide-react";
import { fetchEvents, type LifeEvent } from "../lib/api";
import { domainIcon, formatDomainLabel } from "../lib/format";
import { cn } from "../lib/utils";
import { PageEmptyState } from "./PageEmptyState";

function groupEventsByDate(events: LifeEvent[]): { date: string; items: LifeEvent[] }[] {
  const byDate = new Map<string, LifeEvent[]>();
  for (const event of events) {
    const d = event.date || "Unknown";
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push(event);
  }
  return [...byDate.keys()]
    .sort((a, b) => b.localeCompare(a))
    .map((date) => ({ date, items: byDate.get(date)! }));
}

const DOMAIN_BADGE: Record<string, string> = {
  health: "bg-emerald-50 text-emerald-700 border-emerald-100",
  finance: "bg-amber-50 text-amber-700 border-amber-100",
  projects: "bg-indigo-50 text-indigo-700 border-indigo-100",
  life: "bg-violet-50 text-violet-700 border-violet-100",
  personal: "bg-sky-50 text-sky-700 border-sky-100",
};

export function Memory() {
  const [events, setEvents] = useState<LifeEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

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

  const grouped = useMemo(() => groupEventsByDate(events), [events]);

  const header = (
    <div className="flex justify-between items-end gap-4">
      <div>
        <h1 className="text-4xl font-black text-gray-900 tracking-tight">Memory</h1>
        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.2em] mt-1">
          What AIR4 Knows
        </p>
      </div>
      {!loading && total > 0 && (
        <span className="text-[10px] font-mono text-[#9ca3af] uppercase shrink-0">
          {total} event{total === 1 ? "" : "s"}
        </span>
      )}
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

  if (events.length === 0) {
    return (
      <div className="flex flex-col gap-8 pb-10">
        {header}
        <PageEmptyState
          icon={Database}
          title="No memories yet"
          subtext="Start chatting with AIR4 — your memories will appear here."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 pb-10">
      {header}

      <div className="space-y-8">
        {grouped.map(({ date, items }) => (
          <section key={date}>
            <h2 className="text-[11px] font-bold text-[#9ca3af] uppercase tracking-[0.15em] mb-4 sticky top-0 bg-[#f4f5f7]/90 py-1 backdrop-blur-sm">
              {date}
            </h2>
            <div className="space-y-3">
              {items.map((event) => (
                <article
                  key={event.id}
                  className="bg-white rounded-[20px] p-5 shadow-[0_2px_12px_rgba(0,0,0,0.08)] flex gap-4"
                >
                  <div
                    className="w-11 h-11 rounded-2xl bg-gray-50 flex items-center justify-center text-xl shrink-0"
                    aria-hidden
                  >
                    {domainIcon(event.domain)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2 mb-1">
                      <h3 className="text-[15px] font-bold text-gray-900 leading-snug">
                        {event.title}
                      </h3>
                      <span
                        className={cn(
                          "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-tighter border shrink-0",
                          DOMAIN_BADGE[event.domain] ??
                            "bg-gray-50 text-gray-600 border-gray-100"
                        )}
                      >
                        {formatDomainLabel(event.domain)}
                      </span>
                    </div>
                    {event.description && (
                      <p className="text-[13px] text-gray-600 leading-relaxed mb-2">
                        {event.description}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#9ca3af] font-medium">
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

      {total > events.length && (
        <p className="text-[12px] text-center text-[#9ca3af]">
          Showing latest {events.length} of {total} events
        </p>
      )}
    </div>
  );
}
