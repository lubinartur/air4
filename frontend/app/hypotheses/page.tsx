"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  deleteHypothesis,
  generateHypotheses,
  getHypotheses,
  type Hypothesis,
} from "@/lib/api";
import { HypothesisCard } from "@/components/HypothesisCard";

function Section({
  title,
  collapsed,
  onToggle,
  children,
}: {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-zinc-100 bg-white p-6 shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        className="mb-4 flex w-full items-center justify-between gap-3 text-left"
        aria-expanded={!collapsed}
      >
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
          {title}
        </h2>
        <span className="text-xs text-zinc-400">{collapsed ? "▶" : "▼"}</span>
      </button>
      {!collapsed ? children : null}
    </section>
  );
}

export default function HypothesesPage() {
  const [items, setItems] = useState<Hypothesis[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [genBusy, setGenBusy] = useState(false);
  const [genInfo, setGenInfo] = useState<string | null>(null);

  const [confirmedCollapsed, setConfirmedCollapsed] = useState(true);
  const [rejectedCollapsed, setRejectedCollapsed] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getHypotheses();
      setItems(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load hypotheses");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pending = useMemo(
    () => items.filter((h) => h.status === "pending"),
    [items]
  );
  const confirmed = useMemo(
    () => items.filter((h) => h.status === "confirmed"),
    [items]
  );
  const rejected = useMemo(
    () => items.filter((h) => h.status === "rejected"),
    [items]
  );

  async function onGenerate() {
    setGenBusy(true);
    setGenInfo(null);
    setError(null);
    try {
      const res = await generateHypotheses();
      if (res.created > 0) {
        setGenInfo(`Создано гипотез: ${res.created}`);
      } else if (res.cooldown_hours_remaining != null) {
        setGenInfo(
          `Можно генерировать не чаще 1 раза в день. Осталось часов: ${res.cooldown_hours_remaining.toFixed(
            1
          )}`
        );
      } else {
        setGenInfo("Новых гипотез нет");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generate failed");
    } finally {
      setGenBusy(false);
    }
  }

  async function onDelete(id: number) {
    setError(null);
    try {
      await deleteHypothesis(id);
      setItems((prev) => prev.filter((h) => h.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-zinc-100 bg-white p-6 shadow-sm">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            Patterns
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            Hypotheses AIR4 wants to verify with you
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onGenerate()}
          disabled={genBusy}
          className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {genBusy ? "Generating…" : "Generate new hypotheses"}
        </button>
      </div>

      {genInfo ? (
        <div className="rounded-xl border border-zinc-100 bg-zinc-50 px-4 py-3 text-sm text-zinc-800">
          {genInfo}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="text-sm text-zinc-600">Loading…</div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-zinc-100 bg-white p-8 text-center text-sm text-zinc-700 shadow-sm">
          No hypotheses yet. Click “Generate new hypotheses”.
        </div>
      ) : (
        <div className="grid gap-6">
          <section className="rounded-2xl border border-zinc-100 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-400">
              Pending
            </h2>
            {pending.length === 0 ? (
              <p className="text-sm text-zinc-600">No pending hypotheses.</p>
            ) : (
              <div className="grid gap-3">
                {pending.map((h) => (
                  <div key={h.id}>
                    <HypothesisCard
                      hypothesis={h}
                      onUpdated={(u) =>
                        setItems((prev) =>
                          prev.map((x) => (x.id === u.id ? u : x))
                        )
                      }
                    />
                    <button
                      type="button"
                      onClick={() => void onDelete(h.id)}
                      className="mt-2 text-xs font-medium text-zinc-500 hover:text-zinc-900"
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <Section
            title={`Confirmed (${confirmed.length})`}
            collapsed={confirmedCollapsed}
            onToggle={() => setConfirmedCollapsed((c) => !c)}
          >
            {confirmed.length === 0 ? (
              <p className="text-sm text-zinc-600">No confirmed hypotheses.</p>
            ) : (
              <ul className="grid gap-3">
                {confirmed.map((h) => (
                  <li
                    key={h.id}
                    className="rounded-2xl border border-zinc-100 bg-white p-5 shadow-sm"
                  >
                    <p className="text-sm leading-6 text-zinc-900">{h.text}</p>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title={`Rejected (${rejected.length})`}
            collapsed={rejectedCollapsed}
            onToggle={() => setRejectedCollapsed((c) => !c)}
          >
            {rejected.length === 0 ? (
              <p className="text-sm text-zinc-600">No rejected hypotheses.</p>
            ) : (
              <ul className="grid gap-3">
                {rejected.map((h) => (
                  <li
                    key={h.id}
                    className="rounded-2xl border border-zinc-100 bg-white p-5 shadow-sm"
                  >
                    <p className="text-sm leading-6 text-zinc-900">{h.text}</p>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

