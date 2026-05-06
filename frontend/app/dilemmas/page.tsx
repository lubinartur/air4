"use client";

import { useEffect, useMemo, useState } from "react";
import {
  createDilemma,
  deleteDilemma,
  getDilemmas,
  getPendingFollowups,
  submitFollowup,
  type Dilemma,
} from "@/lib/api";

function formatDateRu(iso: string | null | undefined): string {
  if (!iso) return "—";
  const normalized = iso.includes("T") ? iso : iso.replace(" ", "T");
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ru-RU", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function preview(s: string | null | undefined, max = 160): string {
  const t = (s || "").trim().replace(/\s+/g, " ");
  if (!t) return "—";
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

function renderMultilineParagraphs(text: string) {
  return text
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0)
    .map((line, idx) => (
      <p key={idx} className="text-sm text-zinc-600 leading-relaxed">
        {line}
      </p>
    ));
}

export default function DilemmasPage() {
  const [text, setText] = useState("");
  const [creating, setCreating] = useState(false);
  const [items, setItems] = useState<Dilemma[]>([]);
  const [pendingFollowups, setPendingFollowups] = useState<Dilemma[]>([]);
  const [followupAnswers, setFollowupAnswers] = useState<Record<number, string>>({});
  const [followupBusy, setFollowupBusy] = useState<number | null>(null);
  const [followupThanks, setFollowupThanks] = useState<Record<number, boolean>>({});
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const ds = await getDilemmas();
      setItems(ds || []);
      const pf = await getPendingFollowups();
      setPendingFollowups(pf || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить дилеммы");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCount = useMemo(
    () => (items || []).filter((d) => d.status === "open").length,
    [items]
  );

  async function onSubmitFollowup(d: Dilemma) {
    const ans = (followupAnswers[d.id] || "").trim();
    if (!ans) return;
    setFollowupBusy(d.id);
    setError(null);
    try {
      await submitFollowup(d.id, ans);
      setPendingFollowups((prev) => prev.filter((x) => x.id !== d.id));
      setFollowupThanks((prev) => ({ ...prev, [d.id]: true }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось отправить ответ");
    } finally {
      setFollowupBusy(null);
    }
  }

  async function onCreate() {
    const t = text.trim();
    if (!t) return;
    setCreating(true);
    setError(null);
    try {
      const created = await createDilemma(t);
      setItems((prev) => [created, ...prev]);
      setExpanded((prev) => ({ ...prev, [created.id]: true }));
      setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось разобрать дилемму");
    } finally {
      setCreating(false);
    }
  }

  async function onDelete(id: number) {
    setDeletingId(id);
    setError(null);
    try {
      await deleteDilemma(id);
      setItems((prev) => prev.filter((x) => x.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось удалить");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="grid gap-6">
      <div className="rounded-2xl border border-zinc-100 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          Дилеммы
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          Опиши выбор — AIR4 разложит его с учётом твоего контекста
        </p>
      </div>

      {pendingFollowups.length > 0 ? (
        <section className="rounded-2xl border border-zinc-100 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
              Фоллоу-ап
            </h2>
            <div className="text-xs text-zinc-500">
              Ждут ответа: {pendingFollowups.length}
            </div>
          </div>

          <div className="grid gap-3">
            {pendingFollowups.map((d) => (
              <div
                key={d.id}
                className="rounded-2xl border border-zinc-100 bg-white p-5 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-zinc-900">{d.title}</div>
                    <div className="mt-2 text-sm text-zinc-700">
                      {preview(d.recommendation)}
                    </div>
                    <div className="mt-3 text-sm font-medium text-zinc-900">
                      Как пошло? Ты принял решение?
                    </div>
                  </div>
                </div>

                {followupThanks[d.id] ? (
                  <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                    Спасибо! AIR4 учтёт это.
                  </div>
                ) : (
                  <>
                    <textarea
                      value={followupAnswers[d.id] || ""}
                      onChange={(e) =>
                        setFollowupAnswers((prev) => ({
                          ...prev,
                          [d.id]: e.target.value,
                        }))
                      }
                      rows={3}
                      className="mt-4 w-full resize-y rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 placeholder:text-zinc-500 focus:border-zinc-400 focus:ring-0 focus:outline-none"
                      placeholder="Твой ответ..."
                      disabled={followupBusy === d.id}
                    />
                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={() => void onSubmitFollowup(d)}
                        disabled={
                          followupBusy === d.id ||
                          (followupAnswers[d.id] || "").trim().length === 0
                        }
                        className="rounded-xl bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60"
                      >
                        {followupBusy === d.id ? "Отправляю…" : "Ответить"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-zinc-100 bg-white p-6 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
            Разбор
          </h2>
          <div className="text-xs text-zinc-500">Открытых дилемм: {openCount}</div>
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder="Опиши свою дилемму..."
          className="w-full resize-y rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 placeholder:text-zinc-500 focus:border-zinc-400 focus:ring-0 focus:outline-none"
          disabled={creating}
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => void onCreate()}
            disabled={creating || text.trim().length === 0}
            className="rounded-xl bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60"
          >
            {creating ? "AIR4 анализирует..." : "Разобрать"}
          </button>
          <button
            type="button"
            onClick={() => void load()}
            disabled={creating || loading}
            className="rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-900 disabled:opacity-60"
          >
            Обновить
          </button>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-zinc-100 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-400">
          История
        </h2>

        {loading ? (
          <div className="text-sm text-zinc-600">Загружаю…</div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-zinc-100 bg-zinc-50 p-8 text-center text-sm text-zinc-700">
            Дилемм пока нет.
          </div>
        ) : (
          <div className="grid gap-3">
            {items.map((d) => {
              const isOpen = !!expanded[d.id];
              return (
                <div
                  key={d.id}
                  className="rounded-2xl border border-zinc-100 bg-white p-5 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        setExpanded((prev) => ({ ...prev, [d.id]: !isOpen }))
                      }
                      className="min-w-0 text-left"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-zinc-400">
                          {isOpen ? "▼" : "▶"}
                        </span>
                        <div className="font-medium text-zinc-900">{d.title}</div>
                      </div>
                      <div className="mt-1 text-xs text-zinc-500">
                        {formatDateRu(d.created_at)}
                      </div>
                      <div className="mt-2 text-sm text-zinc-700">
                        {preview(d.recommendation)}
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => void onDelete(d.id)}
                      disabled={deletingId === d.id}
                      className="shrink-0 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800 hover:bg-red-100 disabled:opacity-50"
                    >
                      {deletingId === d.id ? "Удаляю…" : "Удалить"}
                    </button>
                  </div>

                  {isOpen ? (
                    <div className="mt-4 grid gap-4">
                      {d.description ? (
                        <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-4">
                          <div className="text-xs font-medium uppercase tracking-wider text-zinc-400">
                            Дилемма
                          </div>
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-800">
                            {d.description}
                          </p>
                        </div>
                      ) : null}
                      {d.analysis ? (
                        <div className="rounded-xl border border-zinc-100 bg-white p-4">
                          <div className="text-xs font-medium uppercase tracking-wider text-zinc-400">
                            Разбор
                          </div>
                          <div className="mt-2 max-h-48 overflow-y-auto whitespace-pre-line">
                            {renderMultilineParagraphs(d.analysis)}
                          </div>
                        </div>
                      ) : null}
                      {d.recommendation ? (
                        <div className="rounded-xl border border-zinc-100 bg-white p-4">
                          <div className="text-xs font-medium uppercase tracking-wider text-zinc-400">
                            Рекомендация
                          </div>
                          <div className="mt-2 max-h-48 overflow-y-auto whitespace-pre-line">
                            {renderMultilineParagraphs(d.recommendation)}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

