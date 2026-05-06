"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { deleteEvent, getEvents, type LifeEvent } from "@/lib/api";

const CATEGORY_ORDER = [
  "life",
  "health",
  "work",
  "project",
  "finance",
  "travel",
  "other",
];

function categorySortKey(cat: string): number {
  const i = CATEGORY_ORDER.indexOf(cat);
  return i === -1 ? 100 + cat.charCodeAt(0) : i;
}

export default function EventsPage() {
  const [events, setEvents] = useState<LifeEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await getEvents();
      setEvents(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load events");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<string, LifeEvent[]>();
    for (const e of events) {
      const c = e.category || "other";
      if (!map.has(c)) map.set(c, []);
      map.get(c)!.push(e);
    }
    const keys = [...map.keys()].sort(
      (a, b) => categorySortKey(a) - categorySortKey(b) || a.localeCompare(b)
    );
    return keys.map((category) => ({
      category,
      items: map.get(category)!,
    }));
  }, [events]);

  async function onDelete(id: number) {
    setDeletingId(id);
    setError(null);
    try {
      await deleteEvent(id);
      setEvents((prev) => prev.filter((e) => e.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-zinc-100 bg-white p-6 shadow-sm">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            События
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            События из чата или добавленные вручную, по категориям.
          </p>
        </div>
        <Link
          href="/chat"
          className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
        >
          Рассказать AIR4
        </Link>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="text-sm text-zinc-600">Загружаю…</div>
      ) : events.length === 0 ? (
        <div className="rounded-2xl border border-zinc-100 bg-white p-8 text-center text-sm text-zinc-700 shadow-sm">
          Событий пока нет. Расскажи AIR4 о своей жизни в чате.
        </div>
      ) : (
        <div className="grid gap-8">
          {grouped.map(({ category, items }) => (
            <section key={category}>
              <h2 className="mb-4 text-xs font-medium uppercase tracking-wider text-zinc-400">
                {category}
              </h2>
              <ul className="grid gap-3">
                {items.map((ev) => (
                  <li
                    key={ev.id}
                    className="flex flex-col gap-3 rounded-xl border border-zinc-100 bg-white p-4 shadow-sm sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-zinc-500">
                          {ev.date ?? "—"}
                        </span>
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-600">
                          {ev.category}
                        </span>
                      </div>
                      <div className="mt-1 font-medium text-zinc-900">
                        {ev.title}
                      </div>
                      {ev.description ? (
                        <p className="mt-1 text-sm leading-6 text-zinc-500">
                          {ev.description}
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => void onDelete(ev.id)}
                      disabled={deletingId === ev.id}
                      className="shrink-0 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800 hover:bg-red-100 disabled:opacity-50"
                    >
                      {deletingId === ev.id ? "Удаляю…" : "Удалить"}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
