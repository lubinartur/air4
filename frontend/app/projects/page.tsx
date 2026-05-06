"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addProjectLog,
  createProject,
  deleteProject,
  getProject,
  getProjects,
  type Project,
  type ProjectStatus,
  type ProjectWithLogs,
} from "@/lib/api";

const STATUS_LABEL: Record<ProjectStatus, string> = {
  active: "Активен",
  paused: "Пауза",
  completed: "Завершён",
  archived: "Архив",
};

function statusBadgeClass(status: ProjectStatus): string {
  switch (status) {
    case "active":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
    case "paused":
      return "border-amber-500/30 bg-amber-500/10 text-amber-200";
    case "completed":
      return "border-blue-500/30 bg-blue-500/10 text-blue-200";
    case "archived":
      return "border-white/10 bg-white/[0.03] text-zinc-400";
  }
}

export default function ProjectsPage() {
  const [items, setItems] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<ProjectStatus>("active");
  const [startedAt, setStartedAt] = useState("");

  const [openNoteFor, setOpenNoteFor] = useState<number | null>(null);
  const [noteText, setNoteText] = useState("");
  const [addingNoteFor, setAddingNoteFor] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const [logsByProject, setLogsByProject] = useState<Record<number, ProjectWithLogs | undefined>>({});

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await getProjects();
      setItems(data);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Не удалось загрузить проекты"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activeCount = useMemo(
    () => items.filter((p) => p.status === "active").length,
    [items]
  );

  async function onCreate() {
    const n = name.trim();
    if (!n) {
      setError("Название проекта обязательно");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const created = await createProject({
        name: n,
        description: description.trim() ? description.trim() : null,
        status,
        started_at: startedAt.trim() ? startedAt.trim() : null,
      });
      setItems((prev) => [created, ...prev]);
      setName("");
      setDescription("");
      setStatus("active");
      setStartedAt("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setCreating(false);
    }
  }

  async function ensureLogsLoaded(projectId: number) {
    if (logsByProject[projectId]) return;
    try {
      const full = await getProject(projectId);
      setLogsByProject((prev) => ({ ...prev, [projectId]: full }));
    } catch {
      // ignore
    }
  }

  async function onAddNote(projectId: number) {
    const note = noteText.trim();
    if (!note) return;
    setAddingNoteFor(projectId);
    setError(null);
    try {
      const log = await addProjectLog(projectId, note);
      setLogsByProject((prev) => {
        const existing = prev[projectId];
        if (!existing) return prev;
        return {
          ...prev,
          [projectId]: { ...existing, logs: [log, ...(existing.logs || [])] },
        };
      });
      setNoteText("");
      setOpenNoteFor(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось добавить заметку");
    } finally {
      setAddingNoteFor(null);
    }
  }

  async function onDeleteProject(projectId: number) {
    setDeletingId(projectId);
    setError(null);
    try {
      await deleteProject(projectId);
      setItems((prev) => prev.filter((p) => p.id !== projectId));
      setLogsByProject((prev) => {
        const next = { ...prev };
        delete next[projectId];
        return next;
      });
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
            Активные потоки / Онлайн
          </p>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <h1 className="text-5xl font-light tracking-tight text-zinc-100">
              Проекты
            </h1>
            <p className="mt-3 max-w-2xl text-sm font-light leading-relaxed text-zinc-500">
              Активные проекты, статусы и заметки прогресса.
            </p>
          </div>
          <div className="glass-card px-6 py-4 text-right">
            <div className="mono-label text-zinc-500">АКТИВНЫХ</div>
            <div className="mt-1 text-3xl font-light tabular-nums text-zinc-100">
              {activeCount}
            </div>
          </div>
        </div>
      </header>

      {error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <div className="glass-card p-8">
            <div className="mono-label mb-6 text-zinc-300">Новый проект</div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                  Название
                </span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-white/20 focus:ring-0 focus:outline-none"
                  placeholder="например: проект с мотоциклом"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                  Статус
                </span>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as ProjectStatus)}
                  className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-zinc-100 focus:border-white/20 focus:ring-0 focus:outline-none"
                >
                  {(Object.keys(STATUS_LABEL) as ProjectStatus[]).map((k) => (
                    <option key={k} value={k} className="bg-zinc-900">
                      {STATUS_LABEL[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 md:col-span-2">
                <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                  Описание
                </span>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-white/20 focus:ring-0 focus:outline-none"
                  placeholder="Что ты делаешь / к чему идёшь?"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                  Дата начала
                </span>
                <input
                  value={startedAt}
                  onChange={(e) => setStartedAt(e.target.value)}
                  className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-white/20 focus:ring-0 focus:outline-none"
                  placeholder="YYYY-MM-DD (необязательно)"
                />
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => void onCreate()}
                  disabled={creating}
                  className="btn-primary w-full disabled:opacity-60"
                >
                  {creating ? "Добавляю…" : "Добавить"}
                </button>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="text-sm text-zinc-500">Загружаю…</div>
          ) : items.length === 0 ? (
            <div className="glass-card p-10 text-center text-sm text-zinc-500">
              Проектов пока нет.
            </div>
          ) : (
            <ul className="grid gap-4">
              {items.map((p) => {
                const statusCls = statusBadgeClass(p.status);
                const logs = logsByProject[p.id]?.logs || [];
                const lastLog = logs[0]?.note;
                return (
                  <li
                    key={p.id}
                    className="glass-card p-6 group hover:border-white/10 transition-all"
                    onMouseEnter={() => void ensureLogsLoaded(p.id)}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-6">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-light text-zinc-100">
                            {p.name}
                          </h3>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider ${statusCls}`}
                          >
                            {STATUS_LABEL[p.status]}
                          </span>
                        </div>
                        {p.description ? (
                          <p className="mt-2 text-sm leading-6 text-zinc-400">
                            {p.description}
                          </p>
                        ) : null}
                        <div className="mt-4 grid gap-1 text-xs text-zinc-500">
                          <div>Начат: {p.started_at ?? "—"}</div>
                          <div>Последняя заметка: {lastLog ? lastLog : "—"}</div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void onDeleteProject(p.id)}
                        disabled={deletingId === p.id}
                        className="shrink-0 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-200 hover:bg-red-500/20 disabled:opacity-50"
                      >
                        {deletingId === p.id ? "Удаляю…" : "Удалить"}
                      </button>
                    </div>

                    <div className="mt-5 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setOpenNoteFor((cur) => (cur === p.id ? null : p.id));
                          setNoteText("");
                          void ensureLogsLoaded(p.id);
                        }}
                        className="btn-ghost px-3 py-2 text-xs"
                      >
                        Добавить заметку
                      </button>
                    </div>

                    {openNoteFor === p.id ? (
                      <div className="mt-4 grid gap-2">
                        <textarea
                          value={noteText}
                          onChange={(e) => setNoteText(e.target.value)}
                          rows={3}
                          placeholder="Что изменилось? Что ты сделал? Следующий шаг?"
                          className="w-full resize-y rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-white/20 focus:ring-0 focus:outline-none"
                        />
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void onAddNote(p.id)}
                            disabled={
                              addingNoteFor === p.id ||
                              noteText.trim().length === 0
                            }
                            className="btn-primary disabled:opacity-60"
                          >
                            {addingNoteFor === p.id ? "Сохраняю…" : "Сохранить"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setOpenNoteFor(null)}
                            className="btn-ghost disabled:opacity-60"
                          >
                            Отмена
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <aside className="space-y-6">
          <div className="glass-card p-8 border border-amber-500/20 bg-amber-500/5">
            <div className="mono-label mb-4 text-amber-300">Снимок фокуса</div>
            <p className="text-sm font-light leading-relaxed text-zinc-300">
              {items.length === 0
                ? "Добавь проект, чтобы начать отслеживать прогресс."
                : "Наведи на проект, чтобы подтянуть последние логи и держать контекст в поле зрения."}
            </p>
            <div className="mt-6 grid gap-3">
              <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <div className="mono-label text-zinc-500">Всего проектов</div>
                <div className="mt-1 text-2xl font-light tabular-nums text-zinc-100">
                  {items.length}
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <div className="mono-label text-zinc-500">Активных</div>
                <div className="mt-1 text-2xl font-light tabular-nums text-emerald-200">
                  {activeCount}
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

