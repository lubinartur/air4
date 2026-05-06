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
  active: "active",
  paused: "paused",
  completed: "completed",
  archived: "archived",
};

function statusBadgeClass(status: ProjectStatus): string {
  switch (status) {
    case "active":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "paused":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "completed":
      return "border-blue-200 bg-blue-50 text-blue-800";
    case "archived":
      return "border-zinc-200 bg-zinc-50 text-zinc-600";
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
      setError(e instanceof Error ? e.message : "Failed to load projects");
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
      setError("Project name is required");
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
      setError(e instanceof Error ? e.message : "Add note failed");
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
            Projects
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            Track your active projects and progress
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs font-medium uppercase tracking-wider text-zinc-400">
            Active
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-zinc-900">
            {activeCount}
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <div className="rounded-2xl border border-zinc-100 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Add project
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1">
            <span className="text-sm font-medium text-zinc-700">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-400 focus:ring-0 focus:outline-none"
              placeholder="e.g. Motorcycle build"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-medium text-zinc-700">Status</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as ProjectStatus)}
              className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-400 focus:ring-0 focus:outline-none"
            >
              {Object.keys(STATUS_LABEL).map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 md:col-span-2">
            <span className="text-sm font-medium text-zinc-700">
              Description
            </span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-400 focus:ring-0 focus:outline-none"
              placeholder="What are you building / aiming for?"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-medium text-zinc-700">
              Started (YYYY-MM-DD)
            </span>
            <input
              value={startedAt}
              onChange={(e) => setStartedAt(e.target.value)}
              className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-400 focus:ring-0 focus:outline-none"
              placeholder="optional"
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => void onCreate()}
              disabled={creating}
              className="w-full rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
            >
              {creating ? "Creating…" : "Add project"}
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-zinc-600">Loading…</div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-zinc-100 bg-white p-8 text-center text-sm text-zinc-700 shadow-sm">
          No projects yet.
        </div>
      ) : (
        <ul className="grid gap-3">
          {items.map((p) => {
            const statusCls = statusBadgeClass(p.status);
            const logs = logsByProject[p.id]?.logs || [];
            const lastLog = logs[0]?.note;
            return (
              <li
                key={p.id}
                className="rounded-2xl border border-zinc-100 bg-white p-6 shadow-sm"
                onMouseEnter={() => void ensureLogsLoaded(p.id)}
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-zinc-900">
                        {p.name}
                      </h3>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${statusCls}`}
                      >
                        {p.status}
                      </span>
                    </div>
                    {p.description ? (
                      <p className="mt-2 text-sm leading-6 text-zinc-500">
                        {p.description}
                      </p>
                    ) : null}
                    <div className="mt-3 text-xs text-zinc-500">
                      Started: {p.started_at ?? "—"}
                    </div>
                    <div className="mt-2 text-xs text-zinc-500">
                      Last note: {lastLog ? lastLog : "—"}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void onDeleteProject(p.id)}
                    disabled={deletingId === p.id}
                    className="shrink-0 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800 hover:bg-red-100 disabled:opacity-50"
                  >
                    {deletingId === p.id ? "Deleting…" : "Delete"}
                  </button>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setOpenNoteFor((cur) => (cur === p.id ? null : p.id));
                      setNoteText("");
                      void ensureLogsLoaded(p.id);
                    }}
                    className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
                  >
                    Add note
                  </button>
                </div>

                {openNoteFor === p.id ? (
                  <div className="mt-3 grid gap-2">
                    <textarea
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      rows={3}
                      placeholder="What changed? What did you do? Next step?"
                      className="w-full resize-y rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-400 focus:ring-0 focus:outline-none"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void onAddNote(p.id)}
                        disabled={addingNoteFor === p.id || noteText.trim().length === 0}
                        className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                      >
                        {addingNoteFor === p.id ? "Saving…" : "Save note"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setOpenNoteFor(null)}
                        className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-900"
                      >
                        Cancel
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
  );
}

