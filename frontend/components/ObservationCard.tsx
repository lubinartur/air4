"use client";

import { useState } from "react";
import { markObservationRead, type Observation } from "@/lib/api";

function iconForType(t: string): string {
  switch (t) {
    case "anomaly":
      return "⚠️";
    case "milestone":
      return "🎯";
    case "reminder":
      return "🔔";
    case "pattern":
    default:
      return "👁";
  }
}

export function ObservationCard({
  observation,
  onRead,
}: {
  observation: Observation;
  onRead: (updated: Observation) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function markRead() {
    setBusy(true);
    setError(null);
    try {
      const updated = await markObservationRead(observation.id);
      onRead(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось отметить как прочитанное");
    } finally {
      setBusy(false);
    }
  }

  const unread = !observation.is_read;

  return (
    <div
      className={`rounded-2xl border border-zinc-100 p-5 shadow-sm ${
        unread ? "bg-white" : "bg-zinc-50 opacity-80"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm">{iconForType(observation.observation_type)}</span>
            <div className="font-medium text-zinc-900">{observation.title}</div>
          </div>
          <p className="mt-2 text-sm leading-6 text-zinc-600">
            {observation.body}
          </p>
        </div>
        {unread ? (
          <button
            type="button"
            onClick={() => void markRead()}
            disabled={busy}
            className="shrink-0 rounded-xl bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {busy ? "…" : "Прочитано"}
          </button>
        ) : null}
      </div>
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
      {unread ? (
        <div className="mt-4 h-1 w-full rounded-full bg-zinc-100">
          <div className="h-1 w-10 rounded-full bg-zinc-900" />
        </div>
      ) : null}
    </div>
  );
}

