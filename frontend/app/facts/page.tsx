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
      setError(e instanceof Error ? e.message : "Failed to load facts");
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
            What AIR4 knows
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            Facts learned from your conversations. Delete anything incorrect.
          </p>
        </div>
        <Link
          href="/chat"
          className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
        >
          Chat with AIR4
        </Link>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="text-sm text-zinc-600">Loading…</div>
      ) : facts.length === 0 ? (
        <div className="rounded-2xl border border-zinc-100 bg-white p-8 text-center text-sm text-zinc-700 shadow-sm">
          AIR4 hasn&apos;t learned anything yet. Start chatting!
        </div>
      ) : (
        <ul className="grid gap-3">
          {facts.map((fact) => (
            <li
              key={fact.id}
              className="flex flex-col gap-3 rounded-xl border border-zinc-100 bg-white p-4 shadow-sm sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium uppercase tracking-wider text-zinc-400">
                  {formatFactKey(fact.key)}
                </div>
                <p className="mt-1 text-sm font-medium leading-6 text-zinc-900">
                  {fact.value?.trim() ? fact.value : "—"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void onDelete(fact.id)}
                disabled={deletingId === fact.id}
                className="shrink-0 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800 hover:bg-red-100 disabled:opacity-50"
              >
                {deletingId === fact.id ? "Deleting…" : "Delete"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
