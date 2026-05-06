"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  deleteFact,
  getFacts,
  notifyFactsUpdated,
  type UserFact,
} from "@/lib/api";

function formatFactKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) =>
      w.length ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ""
    )
    .join(" ");
}

export default function FactsPage() {
  const [facts, setFacts] = useState<UserFact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await getFacts();
      setFacts(data);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Не удалось загрузить факты"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onDelete(id: number) {
    setDeletingId(id);
    setError(null);
    try {
      await deleteFact(id);
      setFacts((prev) => prev.filter((f) => f.id !== id));
      notifyFactsUpdated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось удалить");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-8">
      <header className="glass-card flex flex-wrap items-start justify-between gap-6 p-8">
        <div>
          <div className="mono-label mb-2 text-zinc-500">База знаний</div>
          <h1 className="text-4xl font-light tracking-tight text-zinc-100">
            Что знает AIR4
          </h1>
          <p className="mt-3 text-sm font-light leading-relaxed text-zinc-500">
            Факты из разговоров. Удали всё неверное.
          </p>
        </div>
        <Link href="/chat" className="btn-primary self-start">
          Написать AIR4
        </Link>
      </header>

      {error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="text-sm text-zinc-500">Загружаю…</div>
      ) : facts.length === 0 ? (
        <div className="glass-card border border-dashed border-white/10 p-10 text-center text-sm text-zinc-500">
          AIR4 пока ничего не знает. Начни общаться!
        </div>
      ) : (
        <ul className="grid gap-3">
          {facts.map((fact) => (
            <li
              key={fact.id}
              className="glass-card flex flex-col gap-3 p-6 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                <div className="mono-label text-zinc-500">
                  {formatFactKey(fact.key)}
                </div>
                <p className="mt-2 text-sm font-medium leading-6 text-zinc-200">
                  {fact.value?.trim() ? fact.value : "—"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void onDelete(fact.id)}
                disabled={deletingId === fact.id}
                className="shrink-0 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-200 hover:bg-red-500/20 disabled:opacity-50"
              >
                {deletingId === fact.id ? "Удаляю…" : "Удалить"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
