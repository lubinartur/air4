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

const CATEGORY_LABEL_RU: Record<string, string> = {
  life: "Жизнь",
  health: "Здоровье",
  work: "Работа",
  project: "Проект",
  finance: "Финансы",
  travel: "Путешествия",
  other: "Другое",
};

function ruEventsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "событие";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20))
    return "события";
  return "событий";
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
      setError(
        e instanceof Error ? e.message : "Не удалось загрузить события"
      );
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
      setError(e instanceof Error ? e.message : "Не удалось удалить");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="pt-4">
        <div className="mb-4 flex items-center gap-4">
          <div className="h-px w-8 bg-brand-accent/50" />
          <p className="mono-label !tracking-[0.3em] text-zinc-500">
            Сигналы жизни / Индекс
          </p>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <h1 className="text-5xl font-light tracking-tight text-zinc-100">
              События
            </h1>
            <p className="mt-3 max-w-3xl text-sm font-light leading-relaxed text-zinc-500">
              События из чата или добавленные вручную, сгруппированы по категориям.
            </p>
          </div>
          <Link href="/chat" className="btn-primary">
            Рассказать AIR4
          </Link>
        </div>
      </header>

      {error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="text-sm text-zinc-500">Загружаю…</div>
      ) : events.length === 0 ? (
        <div className="glass-card p-10 text-center text-sm text-zinc-500">
          Событий пока нет. Расскажи AIR4 о своей жизни в чате.
        </div>
      ) : (
        <div className="grid gap-10">
          {grouped.map(({ category, items }) => (
            <section key={category}>
              <div className="mb-5 flex items-center justify-between gap-4">
                <h2 className="mono-label text-zinc-300">
                  {CATEGORY_LABEL_RU[category] ?? category}
                </h2>
                <div className="mx-8 h-px flex-1 bg-white/5" />
                <div className="mono-label text-zinc-600">
                  {items.length} {ruEventsWord(items.length)}
                </div>
              </div>
              <ul className="grid gap-3">
                {items.map((ev) => (
                  <li
                    key={ev.id}
                    className="glass-card flex flex-col gap-4 p-6 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-600">
                          {ev.date ?? "—"}
                        </span>
                        <span className="rounded border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[9px] font-mono uppercase tracking-wider text-zinc-400">
                          {ev.category}
                        </span>
                      </div>
                      <div className="mt-2 text-base font-medium text-zinc-100">
                        {ev.title}
                      </div>
                      {ev.description ? (
                        <p className="mt-2 text-sm font-light leading-relaxed text-zinc-400">
                          {ev.description}
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => void onDelete(ev.id)}
                      disabled={deletingId === ev.id}
                      className="shrink-0 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-200 hover:bg-red-500/20 disabled:opacity-50"
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
