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
      <p key={idx} className="text-sm text-zinc-400 leading-relaxed">
        {line}
      </p>
    ));
}

type DilemmaSection = { title: string; body: string };

function parseDilemmaSections(raw: string): DilemmaSection[] {
  const t = (raw || "").replace(/\s+/g, " ").trim();
  if (!t) return [];

  const markers: Array<{ re: RegExp; title: string }> = [
    { re: /1\.\s*СУТЬ\s*ВЫБОРА/i, title: "СУТЬ ВЫБОРА" },
    { re: /2\.\s*ВАРИАНТЫ/i, title: "ВАРИАНТЫ" },
    { re: /3\.\s*КОНТЕКСТ/i, title: "КОНТЕКСТ" },
    { re: /РЕКОМЕНДАЦИЯ/i, title: "РЕКОМЕНДАЦИЯ" },
  ];

  const found: Array<{ idx: number; title: string; len: number }> = [];
  for (const m of markers) {
    const match = m.re.exec(t);
    if (match?.index != null) {
      found.push({ idx: match.index, title: m.title, len: match[0].length });
    }
  }
  if (found.length === 0) return [{ title: "ТЕКСТ", body: t }];
  found.sort((a, b) => a.idx - b.idx);

  const sections: DilemmaSection[] = [];
  for (let i = 0; i < found.length; i++) {
    const cur = found[i];
    const next = found[i + 1];
    const start = cur.idx + cur.len;
    const end = next ? next.idx : t.length;
    const body = t.slice(start, end).trim().replace(/^[:\-–—\s]+/, "").trim();
    sections.push({ title: cur.title, body });
  }
  return sections.filter((s) => s.body.trim().length > 0);
}

function renderSectionBody(body: string) {
  const parts = (body || "").split(" - ").map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) {
    return (
      <div className="text-sm text-zinc-300 leading-relaxed mb-3">
        {body.trim()}
      </div>
    );
  }
  const [first, ...rest] = parts;
  return (
    <div className="mb-3">
      <div className="text-sm text-zinc-300 leading-relaxed">{first}</div>
      <div className="mt-2 grid gap-1">
        {rest.map((x, idx) => (
          <div key={idx} className="text-sm text-zinc-300 leading-relaxed">
            · {x}
          </div>
        ))}
      </div>
    </div>
  );
}

function renderStructuredText(raw: string) {
  const sections = parseDilemmaSections(raw);
  if (sections.length === 0) return null;
  return (
    <div className="max-h-48 overflow-y-auto">
      {sections.map((s, idx) => (
        <div key={`${s.title}-${idx}`}>
          <div className="font-semibold uppercase text-zinc-500 text-xs tracking-wider mb-1">
            {s.title}
          </div>
          {renderSectionBody(s.body)}
        </div>
      ))}
    </div>
  );
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
    <div className="space-y-8">
      <header className="glass-card p-8">
        <div className="mono-label mb-2 text-zinc-500">Разбор решений</div>
        <h1 className="text-4xl font-light tracking-tight text-zinc-100">Дилеммы</h1>
        <p className="mt-3 text-sm font-light leading-relaxed text-zinc-500">
          Опиши выбор — AIR4 разложит его с учётом твоего контекста
        </p>
      </header>

      {pendingFollowups.length > 0 ? (
        <section className="glass-card p-8">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="mono-label text-zinc-300">Фоллоу-ап</h2>
            <div className="text-xs font-mono text-zinc-600">
              Ждут ответа: {pendingFollowups.length}
            </div>
          </div>

          <div className="grid gap-3">
            {pendingFollowups.map((d) => (
              <div key={d.id} className="glass-card p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-zinc-100">{d.title}</div>
                    {d.analysis ? (
                      <div className="mt-3">{renderStructuredText(d.analysis)}</div>
                    ) : null}
                    {d.recommendation ? (
                      <div className="mt-3">{renderStructuredText(d.recommendation)}</div>
                    ) : null}
                    <div className="mt-3 text-sm font-medium text-zinc-200">
                      Как пошло? Ты принял решение?
                    </div>
                  </div>
                </div>

                {followupThanks[d.id] ? (
                  <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
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
                      className="mt-4 w-full resize-y rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-white/20 focus:ring-0 focus:outline-none"
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
                        className="btn-primary px-5 py-2.5 disabled:opacity-60"
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

      <section className="glass-card p-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="mono-label text-zinc-300">Разбор</h2>
          <div className="text-xs font-mono text-zinc-600">Открытых дилемм: {openCount}</div>
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder="Опиши свою дилемму..."
          className="w-full resize-y rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-white/20 focus:ring-0 focus:outline-none"
          disabled={creating}
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => void onCreate()}
            disabled={creating || text.trim().length === 0}
            className="btn-primary px-5 py-2.5 disabled:opacity-60"
          >
            {creating ? "AIR4 анализирует..." : "Разобрать"}
          </button>
          <button
            type="button"
            onClick={() => void load()}
            disabled={creating || loading}
            className="btn-ghost px-4 py-2.5 disabled:opacity-60"
          >
            Обновить
          </button>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}
      </section>

      <section className="glass-card p-8">
        <h2 className="mono-label mb-6 text-zinc-300">История</h2>

        {loading ? (
          <div className="text-sm text-zinc-500">Загружаю…</div>
        ) : items.length === 0 ? (
          <div className="glass-card border border-dashed border-white/10 p-8 text-center text-sm text-zinc-500">
            Дилемм пока нет.
          </div>
        ) : (
          <div className="grid gap-3">
            {items.map((d) => {
              const isOpen = !!expanded[d.id];
              return (
                <div key={d.id} className="glass-card p-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        setExpanded((prev) => ({ ...prev, [d.id]: !isOpen }))
                      }
                      className="min-w-0 text-left"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-zinc-500">
                          {isOpen ? "▼" : "▶"}
                        </span>
                        <div className="font-medium text-zinc-100">{d.title}</div>
                      </div>
                      <div className="mt-1 text-xs text-zinc-500">
                        {formatDateRu(d.created_at)}
                      </div>
                      <div className="mt-2 text-sm text-zinc-400">
                        {preview(d.recommendation)}
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => void onDelete(d.id)}
                      disabled={deletingId === d.id}
                      className="shrink-0 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-200 hover:bg-red-500/20 disabled:opacity-50"
                    >
                      {deletingId === d.id ? "Удаляю…" : "Удалить"}
                    </button>
                  </div>

                  {isOpen ? (
                    <div className="mt-4 grid gap-4">
                      {d.description ? (
                        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                          <div className="mono-label text-zinc-500">Дилемма</div>
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-300">
                            {d.description}
                          </p>
                        </div>
                      ) : null}
                      {d.analysis ? (
                        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                          <div className="mono-label text-zinc-500">Разбор</div>
                          <div className="mt-2">{renderStructuredText(d.analysis)}</div>
                        </div>
                      ) : null}
                      {d.recommendation ? (
                        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                          <div className="mono-label text-zinc-500">Рекомендация</div>
                          <div className="mt-2">{renderStructuredText(d.recommendation)}</div>
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

