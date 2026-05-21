import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowLeft,
  CheckSquare,
  Clock,
  Hourglass,
  Play,
  Plus,
  Square,
  StickyNote,
  StopCircle,
} from "lucide-react";
import {
  addProjectLog,
  addTodo,
  fetchProject,
  fetchTodos,
  startSession,
  stopSession,
  toggleTodo,
  type ProjectDetail as ProjectDetailType,
  type ProjectLog,
  type ProjectTodo,
} from "../lib/api";
import { formatProjectStatus, formatRelativeActivity } from "../lib/format";
import { cn } from "../lib/utils";

type Props = {
  projectId: number;
  onBack: () => void;
};

function statusBadgeClass(status: string): string {
  if (status === "active") return "bg-green-50 text-green-600";
  if (status === "stalled") return "bg-red-50 text-red-600";
  if (status === "completed") return "bg-gray-100 text-gray-500";
  if (status === "paused") return "bg-amber-50 text-amber-700";
  return "bg-gray-100 text-gray-500";
}

function logTypeBadgeClass(logType: string): string {
  switch (logType) {
    case "session":
      return "bg-indigo-50 text-indigo-600";
    case "session_start":
      return "bg-indigo-50 text-indigo-400";
    case "milestone":
      return "bg-emerald-50 text-emerald-600";
    case "update":
    default:
      return "bg-gray-100 text-gray-500";
  }
}

function logTypeLabel(logType: string): string {
  return logType.replace(/_/g, " ");
}

function parseIso(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const normalized = iso.includes("T") ? iso : iso.replace(" ", "T") + "Z";
  const t = Date.parse(normalized);
  return Number.isFinite(t) ? t : null;
}

function formatLogDate(iso: string | null | undefined): string {
  const t = parseIso(iso);
  if (t == null) return iso ?? "";
  const d = new Date(t);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function formatTotalMinutes(total: number): string {
  if (total <= 0) return "0 min";
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-tighter",
        statusBadgeClass(status)
      )}
    >
      {formatProjectStatus(status)}
    </span>
  );
}

export function ProjectDetail({ projectId, onBack }: Props) {
  const [project, setProject] = useState<ProjectDetailType | null>(null);
  const [todos, setTodos] = useState<ProjectTodo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const [pendingStop, setPendingStop] = useState(false);
  const [sessionLabel, setSessionLabel] = useState("");
  const [busy, setBusy] = useState(false);

  const [newLog, setNewLog] = useState("");
  const [newTodo, setNewTodo] = useState("");

  const tickRef = useRef<number | null>(null);

  const reloadProject = useCallback(async () => {
    try {
      const data = await fetchProject(projectId);
      setProject(data);
      setSessionStartedAt(parseIso(data.active_session?.started_at ?? null));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load project");
    }
  }, [projectId]);

  const reloadTodos = useCallback(async () => {
    try {
      const data = await fetchTodos(projectId);
      setTodos(data);
    } catch (e) {
      console.error("[ProjectDetail] fetchTodos failed", e);
    }
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      await Promise.allSettled([reloadProject(), reloadTodos()]);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadProject, reloadTodos]);

  useEffect(() => {
    if (sessionStartedAt == null) {
      if (tickRef.current != null) {
        window.clearInterval(tickRef.current);
        tickRef.current = null;
      }
      return;
    }
    setNow(Date.now());
    tickRef.current = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      if (tickRef.current != null) {
        window.clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [sessionStartedAt]);

  const elapsedMs = sessionStartedAt != null ? now - sessionStartedAt : 0;

  const handleStart = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await startSession(projectId);
      const ms = parseIso(res.started_at) ?? Date.now();
      setSessionStartedAt(ms);
      setPendingStop(false);
      setSessionLabel("");
      await reloadProject();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start session");
    } finally {
      setBusy(false);
    }
  }, [busy, projectId, reloadProject]);

  const handleRequestStop = useCallback(() => {
    setPendingStop(true);
  }, []);

  const handleCancelStop = useCallback(() => {
    setPendingStop(false);
    setSessionLabel("");
  }, []);

  const handleConfirmStop = useCallback(async () => {
    const label = sessionLabel.trim();
    if (!label || busy) return;
    setBusy(true);
    setError(null);
    try {
      await stopSession(projectId, label);
      setSessionStartedAt(null);
      setPendingStop(false);
      setSessionLabel("");
      await reloadProject();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to stop session");
    } finally {
      setBusy(false);
    }
  }, [busy, projectId, reloadProject, sessionLabel]);

  const handleAddLog = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      const note = newLog.trim();
      if (!note || busy) return;
      setBusy(true);
      setError(null);
      try {
        await addProjectLog(projectId, note, "update");
        setNewLog("");
        await reloadProject();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to add note");
      } finally {
        setBusy(false);
      }
    },
    [busy, newLog, projectId, reloadProject]
  );

  const handleAddTodo = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      const text = newTodo.trim();
      if (!text || busy) return;
      setBusy(true);
      setError(null);
      try {
        const created = await addTodo(projectId, text);
        setTodos((prev) => [created, ...prev]);
        setNewTodo("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to add todo");
      } finally {
        setBusy(false);
      }
    },
    [busy, newTodo, projectId]
  );

  const handleToggleTodo = useCallback(
    async (todo: ProjectTodo) => {
      setTodos((prev) =>
        prev.map((t) => (t.id === todo.id ? { ...t, done: !t.done } : t))
      );
      try {
        const updated = await toggleTodo(todo.id);
        setTodos((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      } catch (e) {
        setTodos((prev) =>
          prev.map((t) => (t.id === todo.id ? { ...t, done: todo.done } : t))
        );
        setError(e instanceof Error ? e.message : "Failed to update todo");
      }
    },
    []
  );

  const totalMinutes = useMemo(() => {
    if (!project) return 0;
    return project.total_sessions_minutes ?? 0;
  }, [project]);

  const header = (
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-center gap-4 min-w-0">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-[12px] font-bold text-gray-500 hover:text-gray-900 transition-colors uppercase tracking-wider shrink-0"
        >
          <ArrowLeft size={16} />
          Back
        </button>
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-4xl font-black text-gray-900 tracking-tight truncate">
              {project?.name ?? "Project"}
            </h1>
            {project && <StatusBadge status={project.status} />}
          </div>
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.2em] mt-1">
            Project Detail
          </p>
        </div>
      </div>
      {project && (
        <div className="text-right shrink-0">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">
            Total time
          </p>
          <p className="font-mono text-2xl font-black text-gray-900">
            {formatTotalMinutes(totalMinutes)}
          </p>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {formatRelativeActivity(project.updated_at)}
          </p>
        </div>
      )}
    </div>
  );

  if (loading && !project) {
    return (
      <div className="flex flex-col gap-8 pb-10">
        {header}
        <p className="text-[14px] text-[#9ca3af]">Loading…</p>
      </div>
    );
  }

  if (error && !project) {
    return (
      <div className="flex flex-col gap-8 pb-10">
        {header}
        <p className="text-[14px] text-red-500">{error}</p>
      </div>
    );
  }

  if (!project) return null;

  const activeSession = sessionStartedAt != null;

  return (
    <div className="flex flex-col gap-8 pb-10">
      {header}

      {project.description && (
        <p className="text-[14px] text-gray-600 leading-relaxed max-w-3xl">
          {project.description}
        </p>
      )}

      {error && (
        <p className="text-[13px] text-red-500 bg-red-50 px-4 py-3 rounded-xl">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)] flex flex-col gap-5">
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-bold text-[#9ca3af] uppercase tracking-[0.1em]">
              Timer
            </h2>
            {activeSession && (
              <span className="flex items-center gap-1.5 text-[10px] font-bold text-indigo-600 uppercase tracking-widest">
                <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                live
              </span>
            )}
          </div>

          <div className="flex items-baseline gap-3">
            <Hourglass
              size={28}
              className={cn(
                "shrink-0",
                activeSession ? "text-indigo-500" : "text-gray-300"
              )}
            />
            <span className="font-mono text-5xl font-black text-gray-900 tabular-nums">
              {activeSession ? formatElapsed(elapsedMs) : "00:00"}
            </span>
          </div>

          {!activeSession && (
            <button
              type="button"
              onClick={handleStart}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 bg-[#6366f1] text-white px-5 py-3 rounded-[10px] font-bold text-[13px] shadow-lg shadow-indigo-500/20 hover:bg-indigo-700 transition-all uppercase tracking-wider disabled:opacity-60"
            >
              <Play size={16} />
              Start session
            </button>
          )}

          {activeSession && !pendingStop && (
            <button
              type="button"
              onClick={handleRequestStop}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 bg-gray-900 text-white px-5 py-3 rounded-[10px] font-bold text-[13px] hover:bg-gray-800 transition-all uppercase tracking-wider disabled:opacity-60"
            >
              <StopCircle size={16} />
              Stop session
            </button>
          )}

          {activeSession && pendingStop && (
            <div className="flex flex-col gap-3">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                What did you do?
              </label>
              <input
                type="text"
                autoFocus
                value={sessionLabel}
                onChange={(e) => setSessionLabel(e.target.value)}
                placeholder="Верстал главную"
                className="w-full px-4 py-3 rounded-[10px] border border-gray-200 text-[14px] font-medium text-gray-900 focus:outline-none focus:border-indigo-500"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleConfirmStop();
                  if (e.key === "Escape") handleCancelStop();
                }}
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleConfirmStop}
                  disabled={busy || !sessionLabel.trim()}
                  className="flex-1 inline-flex items-center justify-center gap-2 bg-[#6366f1] text-white px-5 py-2.5 rounded-[10px] font-bold text-[12px] hover:bg-indigo-700 transition-all uppercase tracking-wider disabled:opacity-60"
                >
                  Save · {formatElapsed(elapsedMs)}
                </button>
                <button
                  type="button"
                  onClick={handleCancelStop}
                  disabled={busy}
                  className="px-4 py-2.5 rounded-[10px] text-[12px] font-bold text-gray-500 hover:text-gray-900 transition-colors uppercase tracking-wider disabled:opacity-60"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)] flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-bold text-[#9ca3af] uppercase tracking-[0.1em]">
              Todos
            </h2>
            {todos.length > 0 && (
              <span className="text-[10px] font-mono text-[#9ca3af] uppercase">
                {todos.filter((t) => !t.done).length} open · {todos.length} total
              </span>
            )}
          </div>

          <form onSubmit={handleAddTodo} className="flex items-center gap-2">
            <input
              type="text"
              value={newTodo}
              onChange={(e) => setNewTodo(e.target.value)}
              placeholder="Add a todo…"
              className="flex-1 px-4 py-2.5 rounded-[10px] border border-gray-200 text-[14px] font-medium text-gray-900 focus:outline-none focus:border-indigo-500"
            />
            <button
              type="submit"
              disabled={busy || !newTodo.trim()}
              className="inline-flex items-center justify-center gap-1.5 bg-[#6366f1] text-white px-4 py-2.5 rounded-[10px] font-bold text-[12px] hover:bg-indigo-700 transition-all uppercase tracking-wider disabled:opacity-60"
            >
              <Plus size={14} />
              Add
            </button>
          </form>

          {todos.length === 0 ? (
            <p className="text-[13px] text-[#9ca3af] py-3">
              No todos yet — add steps for this project.
            </p>
          ) : (
            <ul className="space-y-2">
              {todos.map((todo) => (
                <li key={todo.id}>
                  <button
                    type="button"
                    onClick={() => void handleToggleTodo(todo)}
                    className={cn(
                      "w-full text-left flex items-start gap-3 px-3 py-2.5 rounded-xl border border-gray-50 bg-gray-50/30 hover:bg-gray-50 transition-colors",
                      todo.done && "opacity-60"
                    )}
                  >
                    <span
                      className={cn(
                        "shrink-0 mt-0.5",
                        todo.done ? "text-indigo-600" : "text-gray-300"
                      )}
                    >
                      {todo.done ? (
                        <CheckSquare size={18} />
                      ) : (
                        <Square size={18} />
                      )}
                    </span>
                    <span
                      className={cn(
                        "text-[14px] font-medium text-gray-900 leading-relaxed",
                        todo.done && "line-through text-gray-400"
                      )}
                    >
                      {todo.text}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)] flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] font-bold text-[#9ca3af] uppercase tracking-[0.1em]">
            Activity log
          </h2>
          {project.logs.length > 0 && (
            <span className="text-[10px] font-mono text-[#9ca3af] uppercase">
              {project.logs.length} entr{project.logs.length === 1 ? "y" : "ies"}
            </span>
          )}
        </div>

        <form onSubmit={handleAddLog} className="flex items-start gap-2">
          <div className="relative flex-1">
            <StickyNote
              size={16}
              className="absolute left-3 top-3 text-gray-300 pointer-events-none"
            />
            <input
              type="text"
              value={newLog}
              onChange={(e) => setNewLog(e.target.value)}
              placeholder="Add a note about progress…"
              className="w-full pl-9 pr-4 py-2.5 rounded-[10px] border border-gray-200 text-[14px] font-medium text-gray-900 focus:outline-none focus:border-indigo-500"
            />
          </div>
          <button
            type="submit"
            disabled={busy || !newLog.trim()}
            className="inline-flex items-center justify-center gap-1.5 bg-[#6366f1] text-white px-4 py-2.5 rounded-[10px] font-bold text-[12px] hover:bg-indigo-700 transition-all uppercase tracking-wider disabled:opacity-60"
          >
            <Plus size={14} />
            Note
          </button>
        </form>

        {project.logs.length === 0 ? (
          <p className="text-[13px] text-[#9ca3af] py-3">No activity yet.</p>
        ) : (
          <ul className="space-y-3">
            {project.logs.map((log: ProjectLog) => (
              <li
                key={log.id}
                className="flex items-start gap-3 p-3 rounded-xl border border-gray-50 bg-gray-50/30"
              >
                <span
                  className={cn(
                    "shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-tighter mt-0.5",
                    logTypeBadgeClass(log.log_type)
                  )}
                >
                  {logTypeLabel(log.log_type)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium text-gray-900 leading-relaxed break-words">
                    {log.note}
                  </p>
                  <div className="flex items-center gap-3 text-[11px] text-gray-400 mt-1">
                    <span className="flex items-center gap-1">
                      <Clock size={11} />
                      {formatLogDate(log.created_at)}
                    </span>
                    {log.duration_minutes != null && (
                      <span className="font-mono font-bold text-indigo-500">
                        {log.duration_minutes} min
                      </span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
