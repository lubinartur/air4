"use client";

import { useState } from "react";
import { updateHypothesis, type Hypothesis } from "@/lib/api";

export function HypothesisCard({
  hypothesis,
  onUpdated,
}: {
  hypothesis: Hypothesis;
  onUpdated: (updated: Hypothesis) => void;
}) {
  const [busy, setBusy] = useState<null | "confirmed" | "rejected">(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(status: "confirmed" | "rejected") {
    setBusy(status);
    setError(null);
    try {
      const updated = await updateHypothesis(hypothesis.id, status);
      onUpdated(updated);
      setDone(true);
      window.setTimeout(() => setDone(false), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className={`glass-card p-5 transition-opacity ${
        done ? "opacity-60" : "opacity-100"
      }`}
    >
      <p className="text-sm leading-6 text-zinc-200">{hypothesis.text}</p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void act("confirmed")}
          disabled={busy !== null}
          className="rounded-xl border border-emerald-500/30 bg-emerald-500/15 px-4 py-2 text-sm font-medium text-emerald-100 hover:bg-emerald-500/25 disabled:opacity-60"
        >
          {busy === "confirmed" ? "…" : "Да, верно"}
        </button>
        <button
          type="button"
          onClick={() => void act("rejected")}
          disabled={busy !== null}
          className="rounded-xl border border-red-500/30 bg-red-500/15 px-4 py-2 text-sm font-medium text-red-100 hover:bg-red-500/25 disabled:opacity-60"
        >
          {busy === "rejected" ? "…" : "Нет, не так"}
        </button>
        {done ? (
          <span className="self-center text-sm font-medium text-zinc-500">
            Сохранено
          </span>
        ) : null}
      </div>

      {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
    </div>
  );
}

