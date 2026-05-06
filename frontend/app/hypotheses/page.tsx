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
    <section className="glass-card p-6">
      <button
        type="button"
        onClick={onToggle}
        className="mb-4 flex w-full items-center justify-between gap-3 text-left"
        aria-expanded={!collapsed}
      >
        <h2 className="mono-label text-zinc-300">{title}</h2>
        <span className="text-xs text-zinc-500">{collapsed ? "▶" : "▼"}</span>
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
      setError(
        e instanceof Error ? e.message : "Не удалось загрузить гипотезы"
      );
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
      setError(e instanceof Error ? e.message : "Не удалось удалить");
    }
  }

  return (
    <div className="space-y-8">
      <header className="glass-card flex flex-wrap items-start justify-between gap-6 p-8">
        <div>
          <div className="mono-label mb-2 text-zinc-500">Распознавание паттернов</div>
          <h1 className="text-4xl font-light tracking-tight text-zinc-100">
            Паттерны
          </h1>
          <p className="mt-3 text-sm font-light leading-relaxed text-zinc-500">
            Гипотезы которые AIR4 хочет проверить с тобой
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onGenerate()}
          disabled={genBusy}
          className="btn-primary self-start disabled:opacity-60"
        >
          {genBusy ? "Генерирую…" : "Сгенерировать гипотезы"}
        </button>
      </header>

      {genInfo ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-zinc-300">
          {genInfo}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="text-sm text-zinc-500">Загружаю…</div>
      ) : items.length === 0 ? (
        <div className="glass-card border border-dashed border-white/10 p-10 text-center text-sm text-zinc-500">
          Пока нет гипотез. Нажми «Сгенерировать гипотезы».
        </div>
      ) : (
        <div className="grid gap-6">
          <section className="glass-card p-8">
            <h2 className="mono-label mb-6 text-zinc-300">Ожидают ответа</h2>
            {pending.length === 0 ? (
              <p className="text-sm text-zinc-500">Нет новых гипотез.</p>
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
                      className="mt-2 text-xs font-medium text-zinc-500 hover:text-zinc-200"
                    >
                      Удалить
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <Section
            title={`ПОДТВЕРЖДЁННЫЕ (${confirmed.length})`}
            collapsed={confirmedCollapsed}
            onToggle={() => setConfirmedCollapsed((c) => !c)}
          >
            {confirmed.length === 0 ? (
              <p className="text-sm text-zinc-500">Нет подтверждённых гипотез.</p>
            ) : (
              <ul className="grid gap-3">
                {confirmed.map((h) => (
                  <li key={h.id} className="glass-card p-5">
                    <p className="text-sm leading-6 text-zinc-200">{h.text}</p>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title={`ОТКЛОНЁННЫЕ (${rejected.length})`}
            collapsed={rejectedCollapsed}
            onToggle={() => setRejectedCollapsed((c) => !c)}
          >
            {rejected.length === 0 ? (
              <p className="text-sm text-zinc-500">Нет отклонённых гипотез.</p>
            ) : (
              <ul className="grid gap-3">
                {rejected.map((h) => (
                  <li key={h.id} className="glass-card p-5">
                    <p className="text-sm leading-6 text-zinc-200">{h.text}</p>
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

