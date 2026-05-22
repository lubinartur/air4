import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ArrowLeft,
  Bell,
  Briefcase,
  Check,
  Clock,
  ListTodo,
  Pause,
  Play,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "../lib/utils";
import { t } from "../lib/typography";
import {
  addProjectLog,
  addTodo,
  createProject,
  fetchProject,
  fetchProjects,
  fetchTodos,
  startSession,
  stopSession,
  toggleTodo,
  type Project,
  type ProjectDetail,
  type ProjectLog,
  type ProjectTodo,
} from "../lib/api";
import { daysSince } from "../lib/format";

const POMODORO_SECONDS = 1500; // 25 min

const StatusDot = ({ color = "#ef4444" }: { color?: string }) => (
  <div className="absolute top-3 right-3 w-4 h-4 flex items-center justify-center pointer-events-none">
    <div
      className="absolute w-4 h-4 rounded-full opacity-50 animate-ping"
      style={{ backgroundColor: color }}
    />
    <div
      className="relative w-2 h-2 rounded-full"
      style={{ backgroundColor: color }}
    />
  </div>
);

type UiStatus = "ACTIVE" | "STALLED" | "COMPLETED" | "PAUSED" | "ARCHIVED";

function toUiStatus(raw: string): UiStatus {
  const s = (raw || "active").toUpperCase();
  if (s === "ACTIVE" || s === "STALLED" || s === "COMPLETED" || s === "PAUSED" || s === "ARCHIVED") {
    return s;
  }
  return "ACTIVE";
}

/** Days since updated_at → momentum percentage (step function per spec). */
function momentumFromDays(days: number): number {
  if (days <= 3) return 100;
  if (days <= 7) return 60;
  if (days < 14) return 40;
  return 20;
}

function formatTotalTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h} ч ${m} мин`;
}

function formatCountdown(seconds: number): string {
  const safe = Math.max(0, seconds);
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function parseServerIso(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const normalized = raw.includes("T") ? raw : `${raw.replace(" ", "T")}Z`;
  const t = Date.parse(normalized);
  return Number.isNaN(t) ? null : new Date(t);
}

function formatLogTimestamp(iso: string | null | undefined): string {
  const d = parseServerIso(iso);
  if (!d) return "—";
  return d.toLocaleString("ru-RU", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function logTypeLabel(type: string): "SESSION" | "MILESTONE" | "UPDATE" {
  const t = (type || "").toLowerCase();
  if (t === "session") return "SESSION";
  if (t === "milestone") return "MILESTONE";
  return "UPDATE";
}

export function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState<string | null>(null);

  // Create form
  const [showAddProject, setShowAddProject] = useState(false);
  const [newProjName, setNewProjName] = useState("");
  const [newProjDesc, setNewProjDesc] = useState("");
  const [newProjStatus, setNewProjStatus] = useState<"ACTIVE" | "STALLED" | "COMPLETED">("ACTIVE");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Detail view state
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [todos, setTodos] = useState<ProjectTodo[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Timer state
  const [timerActive, setTimerActive] = useState(false);
  const [timeLeft, setTimeLeft] = useState(POMODORO_SECONDS);
  const [secondsElapsedThisSession, setSecondsElapsedThisSession] = useState(0);
  const [showNotesForm, setShowNotesForm] = useState(false);
  const [sessionNotesInput, setSessionNotesInput] = useState("");
  const [sessionBusy, setSessionBusy] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  // Todo form
  const [newTodoText, setNewTodoText] = useState("");
  const [todoBusy, setTodoBusy] = useState(false);

  // Activity log form
  const [newLogText, setNewLogText] = useState("");
  const [selectedLogType, setSelectedLogType] = useState<"update" | "milestone">("update");
  const [logBusy, setLogBusy] = useState(false);

  const loadProjects = useCallback(async () => {
    setProjectsLoading(true);
    setProjectsError(null);
    try {
      const data = await fetchProjects();
      setProjects(data);
    } catch (err) {
      setProjectsError(err instanceof Error ? err.message : "Не удалось загрузить проекты");
      setProjects([]);
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const loadDetail = useCallback(async (id: number) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const [d, t] = await Promise.all([fetchProject(id), fetchTodos(id)]);
      setDetail(d);
      setTodos(t);
      // Sync timer with backend active session, if any
      if (d.active_session) {
        const startedDate = parseServerIso(d.active_session.started_at);
        if (startedDate) {
          const elapsed = Math.max(
            0,
            Math.floor((Date.now() - startedDate.getTime()) / 1000)
          );
          setTimerActive(true);
          setSecondsElapsedThisSession(elapsed);
          setTimeLeft(Math.max(0, POMODORO_SECONDS - elapsed));
        }
      } else {
        setTimerActive(false);
        setSecondsElapsedThisSession(0);
        setTimeLeft(POMODORO_SECONDS);
        setShowNotesForm(false);
      }
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Не удалось загрузить проект");
      setDetail(null);
      setTodos([]);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId == null) {
      setDetail(null);
      setTodos([]);
      setTimerActive(false);
      setSecondsElapsedThisSession(0);
      setTimeLeft(POMODORO_SECONDS);
      setShowNotesForm(false);
      setSessionNotesInput("");
      setSessionError(null);
      return;
    }
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  // Tick (cap timeLeft at 0; don't auto-stop because backend session keeps running)
  const tickRef = useRef<number | null>(null);
  useEffect(() => {
    if (!timerActive) {
      if (tickRef.current != null) {
        window.clearInterval(tickRef.current);
        tickRef.current = null;
      }
      return;
    }
    tickRef.current = window.setInterval(() => {
      setSecondsElapsedThisSession((s) => s + 1);
      setTimeLeft((t) => Math.max(0, t - 1));
    }, 1000);
    return () => {
      if (tickRef.current != null) {
        window.clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [timerActive]);

  const focusDistribution = useMemo(() => {
    const totals = projects.map((p) => ({
      id: p.id,
      name: p.name,
      minutes: p.total_sessions_minutes ?? 0,
    }));
    const totalMinutes = totals.reduce((acc, p) => acc + p.minutes, 0);
    const palette = [
      "bg-indigo-600",
      "bg-indigo-400",
      "bg-violet-400",
      "bg-teal-500",
      "bg-amber-500",
      "bg-rose-400",
    ];
    if (totalMinutes === 0) {
      return totals.slice(0, 5).map((p, i) => ({
        name: p.name,
        percentage: 0,
        color: palette[i % palette.length],
      }));
    }
    return totals
      .map((p, i) => ({
        name: p.name,
        percentage: Math.round((p.minutes / totalMinutes) * 100),
        color: palette[i % palette.length],
        rawMinutes: p.minutes,
      }))
      .sort((a, b) => (b.rawMinutes ?? 0) - (a.rawMinutes ?? 0))
      .slice(0, 5);
  }, [projects]);

  const stalledCount = useMemo(
    () =>
      projects.filter((p) => {
        const days = daysSince(p.updated_at);
        return days >= 14;
      }).length,
    [projects]
  );

  const handleCreateProject = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const name = newProjName.trim();
      if (!name) {
        setCreateError("Введите название");
        return;
      }
      setCreating(true);
      setCreateError(null);
      try {
        await createProject({
          name,
          description: newProjDesc.trim() || null,
          status: newProjStatus.toLowerCase(),
        });
        setNewProjName("");
        setNewProjDesc("");
        setNewProjStatus("ACTIVE");
        setShowAddProject(false);
        await loadProjects();
      } catch (err) {
        setCreateError(err instanceof Error ? err.message : "Не удалось создать проект");
      } finally {
        setCreating(false);
      }
    },
    [newProjName, newProjDesc, newProjStatus, loadProjects]
  );

  const handleToggleTodo = useCallback(async (todoId: number) => {
    setTodos((prev) =>
      prev.map((t) => (t.id === todoId ? { ...t, done: !t.done } : t))
    );
    try {
      const updated = await toggleTodo(todoId);
      setTodos((prev) => prev.map((t) => (t.id === todoId ? updated : t)));
    } catch (err) {
      // Rollback on error
      setTodos((prev) =>
        prev.map((t) => (t.id === todoId ? { ...t, done: !t.done } : t))
      );
      console.error("[Projects] toggleTodo failed", err);
    }
  }, []);

  const handleAddTodo = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const text = newTodoText.trim();
      if (!text || selectedId == null) return;
      setTodoBusy(true);
      try {
        const created = await addTodo(selectedId, text);
        setTodos((prev) => [created, ...prev]);
        setNewTodoText("");
      } catch (err) {
        console.error("[Projects] addTodo failed", err);
      } finally {
        setTodoBusy(false);
      }
    },
    [newTodoText, selectedId]
  );

  const handleAddActivityLog = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const note = newLogText.trim();
      if (!note || selectedId == null) return;
      setLogBusy(true);
      try {
        const log = await addProjectLog(selectedId, note, selectedLogType);
        setDetail((prev) =>
          prev ? { ...prev, logs: [log, ...prev.logs] } : prev
        );
        setNewLogText("");
        // Refresh list so updated_at + momentum reflect the new log
        void loadProjects();
      } catch (err) {
        console.error("[Projects] addProjectLog failed", err);
      } finally {
        setLogBusy(false);
      }
    },
    [newLogText, selectedId, selectedLogType, loadProjects]
  );

  const handleStartSession = useCallback(async () => {
    if (selectedId == null) return;
    setSessionBusy(true);
    setSessionError(null);
    try {
      await startSession(selectedId);
      setTimerActive(true);
      setShowNotesForm(false);
      setSecondsElapsedThisSession(0);
      setTimeLeft(POMODORO_SECONDS);
    } catch (err) {
      setSessionError(err instanceof Error ? err.message : "Не удалось начать сессию");
    } finally {
      setSessionBusy(false);
    }
  }, [selectedId]);

  const handleStopSession = useCallback(() => {
    setTimerActive(false);
    setShowNotesForm(true);
  }, []);

  const handleSaveSessionNotes = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (selectedId == null) return;
      const label = sessionNotesInput.trim() || "Фокус-сессия";
      setSessionBusy(true);
      setSessionError(null);
      try {
        const log = await stopSession(selectedId, label);
        setDetail((prev) => {
          if (!prev) return prev;
          const addedMinutes = log.duration_minutes ?? 0;
          return {
            ...prev,
            logs: [log, ...prev.logs],
            total_sessions_minutes:
              (prev.total_sessions_minutes ?? 0) + addedMinutes,
            active_session: null,
          };
        });
        setSessionNotesInput("");
        setShowNotesForm(false);
        setSecondsElapsedThisSession(0);
        setTimeLeft(POMODORO_SECONDS);
        void loadProjects();
      } catch (err) {
        setSessionError(err instanceof Error ? err.message : "Не удалось сохранить сессию");
      } finally {
        setSessionBusy(false);
      }
    },
    [selectedId, sessionNotesInput, loadProjects]
  );

  const handleResetTimer = useCallback(() => {
    // UI-only reset. If a backend session is open it stays open — user should
    // stop+save to close it.
    setTimerActive(false);
    setShowNotesForm(false);
    setSecondsElapsedThisSession(0);
    setTimeLeft(POMODORO_SECONDS);
    setSessionError(null);
  }, []);

  const handleBackToOverview = useCallback(() => {
    setSelectedId(null);
  }, []);

  // ============== DETAIL VIEW ==============

  if (selectedId != null) {
    const totalMinutes = detail?.total_sessions_minutes ?? 0;
    const totalOutput = formatTotalTime(totalMinutes * 60);
    const uiStatus = detail ? toUiStatus(detail.status) : "ACTIVE";
    const projectName = detail?.name ?? "Проект";

    let dynamicInsight =
      "AIR4: Фокус-сигналов давно не было. Запустите 25-минутный таймер Pomodoro в этом разделе, чтобы вернуть импульс развития.";
    if (detail) {
      const days = daysSince(detail.updated_at);
      const momentum = momentumFromDays(days);
      const dayWord =
        days % 10 === 1 && days % 100 !== 11
          ? "день"
          : days % 10 >= 2 && days % 10 <= 4 && (days % 100 < 12 || days % 100 > 14)
          ? "дня"
          : "дней";
      if (days >= 14) {
        dynamicInsight = `AIR4: «${projectName}» молчит уже ${days} ${dayWord}. Запишите сессию или milestone, чтобы вернуть импульс.`;
      } else if (momentum < 60) {
        dynamicInsight = `AIR4: «${projectName}» — импульс ${momentum}%. Назначьте следующий результат и запустите активную сессию.`;
      } else {
        dynamicInsight = `AIR4: «${projectName}» — импульс ${momentum}%, здоровый темп. Держите ритм — возьмите следующую задачу и проведите фокус-блок.`;
      }
    }

    return (
      <div className="flex flex-col gap-6 pb-12 select-none font-sans">
        {/* Detail Header */}
        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex items-center gap-4">
            <button
              onClick={handleBackToOverview}
              className="p-2.5 bg-gray-50 border border-gray-100 rounded-xl text-gray-400 hover:text-indigo-600 hover:bg-indigo-50/50 hover:border-indigo-100 transition-all flex items-center justify-center shrink-0"
              title="Назад к списку"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className={t.pageTitle}>
                  {projectName}
                </h1>
                {detail && (
                  <span
                    className={cn(
                      "text-[9px] font-black px-2 py-0.5 rounded uppercase tracking-wider",
                      uiStatus === "ACTIVE"
                        ? "bg-green-50 text-green-600"
                        : uiStatus === "STALLED"
                          ? "bg-red-50 text-red-600"
                          : "bg-gray-100 text-gray-600"
                    )}
                  >
                    {uiStatus === "ACTIVE"
                      ? "АКТИВЕН"
                      : uiStatus === "STALLED"
                      ? "ЗАСТРЯЛ"
                      : uiStatus === "COMPLETED"
                      ? "ЗАВЕРШЁН"
                      : uiStatus === "PAUSED"
                      ? "НА ПАУЗЕ"
                      : "В АРХИВЕ"}
                  </span>
                )}
              </div>
              <p className={cn(t.pageSub, "mt-0.5")}>
                Детали проекта и структурированные микро-спринты
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 bg-indigo-50/50 border border-indigo-100 px-4 py-2 rounded-xl">
            <Clock size={15} className="text-indigo-600" />
            <div>
              <p className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">
                Всего времени
              </p>
              <p className="text-sm font-black text-indigo-800 leading-none mt-0.5">
                {totalOutput}
              </p>
            </div>
          </div>
        </div>

        {detailLoading && (
          <div className="bg-white p-6 rounded-[20px] shadow-sm border border-gray-100">
            <p className="text-[14px] text-[#9ca3af]">Загрузка проекта…</p>
          </div>
        )}

        {detailError && (
          <div className="bg-rose-50 border border-rose-100 p-4 rounded-2xl text-[12px] text-rose-600">
            {detailError}
          </div>
        )}

        {!detailLoading && detail && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left col-span-2 */}
            <div className="lg:col-span-2 space-y-6">
              {/* Timer */}
              <div className="bg-white p-6 rounded-[20px] shadow-sm border border-gray-100 space-y-6">
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="text-sm font-bold text-gray-900">
                      Активный фокус-таймер
                    </h3>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      Структурированные спринты разработки. Стандартный цикл Pomodoro.
                    </p>
                  </div>
                  {timerActive && (
                    <span className="flex items-center gap-1.5 px-2 py-1 bg-red-50 border border-red-100 rounded-lg text-red-600 font-bold text-[10px] tracking-wide uppercase">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                      Идёт фокус
                    </span>
                  )}
                </div>

                <div className="flex flex-col items-center justify-center py-6 bg-gray-50/40 border border-gray-100/50 rounded-2xl relative">
                  {secondsElapsedThisSession > 0 && !timerActive && !showNotesForm && (
                    <div className="absolute top-4 text-[10px] font-bold text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded">
                      Пауза: записано {formatCountdown(secondsElapsedThisSession)}
                    </div>
                  )}

                  <div className="text-7xl font-black text-gray-900 font-mono tracking-tight tabular-nums">
                    {formatCountdown(timeLeft)}
                  </div>

                  {secondsElapsedThisSession > 0 && (
                    <p className="text-[10px] text-gray-400 font-mono mt-2 uppercase tracking-wider">
                      Прошло: {formatCountdown(secondsElapsedThisSession)}
                    </p>
                  )}

                  <div className="flex gap-3 mt-6">
                    {!timerActive ? (
                      <button
                        onClick={handleStartSession}
                        disabled={sessionBusy || showNotesForm}
                        className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-black text-xs uppercase tracking-wider rounded-xl shadow-sm hover:shadow-md transition-all flex items-center gap-2"
                      >
                        <Play size={14} className="fill-white" />
                        {sessionBusy ? "Запуск…" : "Начать сессию"}
                      </button>
                    ) : (
                      <button
                        onClick={handleStopSession}
                        className="px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-black text-xs uppercase tracking-wider rounded-xl shadow-sm hover:shadow-md transition-all flex items-center gap-2"
                      >
                        <Pause size={14} className="fill-white" />
                        Остановить
                      </button>
                    )}

                    {(timeLeft !== POMODORO_SECONDS || secondsElapsedThisSession > 0) && !timerActive && !showNotesForm && (
                      <button
                        onClick={handleResetTimer}
                        className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-600 font-black text-xs uppercase tracking-wider rounded-xl transition-all"
                      >
                        Сбросить
                      </button>
                    )}
                  </div>
                </div>

                {sessionError && (
                  <p className="text-[11px] text-rose-500 font-medium">{sessionError}</p>
                )}

                <AnimatePresence>
                  {showNotesForm && (
                    <motion.form
                      onSubmit={handleSaveSessionNotes}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="bg-indigo-50/50 border border-indigo-100 p-5 rounded-2xl space-y-4 overflow-hidden"
                    >
                      <div>
                        <h4 className="text-xs font-black text-indigo-800 uppercase tracking-wider">
                          Сохранить фокус-сессию
                        </h4>
                        <p className="text-[11px] text-gray-400 mt-1">
                          Сервер зафиксирует длительность с начала сессии (пока — {Math.max(1, Math.round(secondsElapsedThisSession / 60))} мин).
                        </p>
                      </div>

                      <div className="flex flex-col md:flex-row gap-3">
                        <input
                          type="text"
                          placeholder="Что вы делали в этой фокус-сессии?"
                          required
                          value={sessionNotesInput}
                          onChange={(e) => setSessionNotesInput(e.target.value)}
                          disabled={sessionBusy}
                          className="flex-1 px-4 py-2 bg-white border border-indigo-200/50 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500 text-gray-800 disabled:opacity-50"
                        />
                        <button
                          type="submit"
                          disabled={sessionBusy}
                          className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all"
                        >
                          {sessionBusy ? "Сохранение…" : "Сохранить запись"}
                        </button>
                      </div>
                    </motion.form>
                  )}
                </AnimatePresence>
              </div>

              {/* Todos */}
              <div className="bg-white p-6 rounded-[20px] shadow-sm border border-gray-100 space-y-5">
                <div>
                  <h3 className="text-sm font-bold text-gray-900">
                    Milestone и чек-лист
                  </h3>
                  <p className="text-[11px] text-gray-400 mt-0.5 font-medium">
                    Определите цели разработки, чтобы прийти к нужному результату.
                  </p>
                </div>

                <form onSubmit={handleAddTodo} className="flex gap-2.5">
                  <input
                    type="text"
                    placeholder="Добавить задачу..."
                    value={newTodoText}
                    onChange={(e) => setNewTodoText(e.target.value)}
                    disabled={todoBusy}
                    className="flex-grow px-4 py-2 bg-gray-50 border border-gray-100 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500/50 transition-all text-gray-800 disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={todoBusy || !newTodoText.trim()}
                    className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-black px-4 py-2 rounded-xl text-xs uppercase tracking-wider transition-colors flex items-center justify-center"
                  >
                    <Plus size={14} className="mr-1" />
                    Добавить
                  </button>
                </form>

                <div className="divide-y divide-gray-50 max-h-[350px] overflow-y-auto pr-1">
                  {todos.length > 0 ? (
                    todos.map((todo) => (
                      <div
                        key={todo.id}
                        className="py-3 flex items-center justify-between gap-4 group"
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <button
                            onClick={() => handleToggleTodo(todo.id)}
                            className={cn(
                              "w-5 h-5 rounded-md border flex items-center justify-center transition-all shrink-0",
                              todo.done
                                ? "bg-indigo-100 border-indigo-500 text-indigo-600"
                                : "border-gray-300 hover:border-gray-500 text-transparent"
                            )}
                          >
                            <Check size={12} strokeWidth={3} />
                          </button>

                          <span
                            className={cn(
                              "text-xs font-medium transition-all truncate",
                              todo.done
                                ? "line-through text-gray-400 italic"
                                : "text-gray-700"
                            )}
                          >
                            {todo.text}
                          </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="py-8 text-center text-gray-400 text-xs flex flex-col items-center justify-center">
                      <ListTodo size={24} className="text-gray-300 mb-2" />
                      Целей пока нет. Добавьте задачу выше, чтобы собрать чек-лист.
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Right col-span-1 */}
            <div className="space-y-6">
              {/* AIR4 Project Deck */}
              <div className="bg-[#1a1a2e] rounded-[20px] p-6 shadow-sm border border-slate-800 text-white relative">
                <StatusDot color="#ef4444" />
                <div className="flex gap-3">
                  <div className="shrink-0 w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center text-white shadow-md">
                    <Bell size={16} />
                  </div>
                  <div>
                    <h4 className="text-[11px] font-black tracking-widest text-[#9ca3af] uppercase">
                      Отчёт AIR4 по проекту
                    </h4>
                    <p className="text-[13px] leading-relaxed font-bold mt-2 text-indigo-100">
                      “{dynamicInsight}”
                    </p>
                  </div>
                </div>
              </div>

              {/* Activity Log */}
              <div className="bg-white p-6 rounded-[20px] shadow-sm border border-gray-100 space-y-5">
                <div>
                  <h3 className="text-sm font-bold text-gray-900">
                    Поток и журнал проекта
                  </h3>
                  <p className="text-[11px] text-gray-400 mt-0.5 font-medium">
                    Ведите журнал milestone'ов, сессий и обычных коммитов.
                  </p>
                </div>

                <form
                  onSubmit={handleAddActivityLog}
                  className="space-y-3 p-3 bg-gray-50/50 border border-gray-100 rounded-xl"
                >
                  <input
                    type="text"
                    placeholder="Добавить заметку или обновление статуса..."
                    required
                    value={newLogText}
                    onChange={(e) => setNewLogText(e.target.value)}
                    disabled={logBusy}
                    className="w-full px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500 text-gray-800 disabled:opacity-50"
                  />

                  <div className="flex items-center justify-between gap-2.5">
                    <div className="flex gap-1.5">
                      {(["update", "milestone"] as const).map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => setSelectedLogType(type)}
                          className={cn(
                            "px-2 py-0.5 rounded text-[9px] font-bold uppercase transition-all border",
                            selectedLogType === type
                              ? type === "milestone"
                                ? "bg-violet-50 text-violet-600 border-violet-200"
                                : "bg-blue-50 text-blue-600 border-blue-200"
                              : "bg-white text-gray-400 border-gray-100 hover:text-gray-600"
                          )}
                        >
                          {type === "milestone" ? "MILESTONE" : "ЗАПИСЬ"}
                        </button>
                      ))}
                    </div>

                    <button
                      type="submit"
                      disabled={logBusy || !newLogText.trim()}
                      className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-black px-3 py-1 rounded-lg text-[10px] uppercase tracking-wider transition-colors"
                    >
                      {logBusy ? "…" : "Запись"}
                    </button>
                  </div>
                </form>

                <div className="space-y-3.5 max-h-[350px] overflow-y-auto pr-1">
                  {detail.logs.length > 0 ? (
                    detail.logs.map((log: ProjectLog) => {
                      const label = logTypeLabel(log.log_type);
                      const isSession = label === "SESSION";
                      const isMilestone = label === "MILESTONE";
                      return (
                        <div
                          key={log.id}
                          className="text-xs space-y-1 relative pl-3 border-l-2 border-indigo-100/50"
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                "text-[8px] font-black px-1.5 py-0.5 rounded uppercase",
                                isSession
                                  ? "bg-indigo-50 text-indigo-600"
                                  : isMilestone
                                    ? "bg-violet-50 text-violet-600"
                                    : "bg-blue-50 text-blue-600"
                              )}
                            >
                              {label === "SESSION"
                                ? "СЕССИЯ"
                                : label === "MILESTONE"
                                ? "MILESTONE"
                                : "ЗАПИСЬ"}
                            </span>
                            <span className="text-[10px] text-gray-400 font-mono">
                              {formatLogTimestamp(log.created_at)}
                            </span>
                          </div>
                          <p className="text-gray-700 font-medium leading-relaxed whitespace-pre-wrap">
                            {log.note}
                          </p>
                        </div>
                      );
                    })
                  ) : (
                    <div className="py-6 text-center text-gray-400 italic">
                      Записей активности пока нет.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ============== LIST VIEW ==============

  return (
    <div className="flex flex-col gap-6 pb-12 select-none font-sans">
      {/* Banner */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
              <Briefcase size={22} className="fill-indigo-100" />
            </div>
            <div>
              <h1 className={t.pageTitle}>
                Командный центр проектов
              </h1>
              <p className={cn(t.pageSub, "mt-0.5")}>
                Активные проекты, сессии и фокус-трекинг
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-indigo-50/50 border border-indigo-100 px-3.5 py-1.5 rounded-xl">
          <Sparkles size={14} className="text-indigo-600" />
          <span className="text-xs font-bold text-indigo-700">
            Советник по проектам
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left col-span-2 */}
        <div className="lg:col-span-2 space-y-6">
          {/* Directory + Add form */}
          <div className="bg-white p-5 rounded-[20px] shadow-sm border border-gray-100 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-gray-900">Каталог проектов</h3>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  Управляйте целями и активной разработкой.
                </p>
              </div>

              <button
                onClick={() => {
                  setShowAddProject((v) => !v);
                  setCreateError(null);
                }}
                className="flex items-center gap-1.5 text-xs text-indigo-600 font-bold bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-100 hover:bg-indigo-100/50 transition-colors"
              >
                {showAddProject ? <X size={14} /> : <Plus size={14} />}
                {showAddProject ? "Закрыть форму" : "Создать проект"}
              </button>
            </div>

            <AnimatePresence>
              {showAddProject && (
                <motion.form
                  onSubmit={handleCreateProject}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="bg-gray-50 border border-gray-100 p-4 rounded-xl space-y-3 overflow-hidden text-xs"
                >
                  <p className="font-bold text-gray-700">Новый проект</p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                        Название проекта
                      </span>
                      <input
                        type="text"
                        placeholder="например, Memory Vault"
                        required
                        value={newProjName}
                        onChange={(e) => setNewProjName(e.target.value)}
                        disabled={creating}
                        className="p-2 border border-gray-200 outline-none rounded bg-white text-gray-800 focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
                      />
                    </div>

                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                        Стартовый статус
                      </span>
                      <select
                        value={newProjStatus}
                        onChange={(e) =>
                          setNewProjStatus(
                            e.target.value as "ACTIVE" | "STALLED" | "COMPLETED"
                          )
                        }
                        disabled={creating}
                        className="p-2 border border-gray-200 outline-none rounded bg-white text-gray-800 disabled:opacity-50"
                      >
                        <option value="ACTIVE">АКТИВЕН</option>
                        <option value="STALLED">ЗАСТРЯЛ</option>
                        <option value="COMPLETED">ЗАВЕРШЁН</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                      Описание
                    </span>
                    <input
                      type="text"
                      placeholder="Краткое описание целей..."
                      value={newProjDesc}
                      onChange={(e) => setNewProjDesc(e.target.value)}
                      disabled={creating}
                      className="p-2 border border-gray-200 outline-none rounded bg-white text-gray-800 focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
                    />
                  </div>

                  {createError && (
                    <p className="text-[11px] text-rose-500 font-medium">{createError}</p>
                  )}

                  <div className="flex justify-end pt-2">
                    <button
                      type="submit"
                      disabled={creating}
                      className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-extrabold px-4 py-2 rounded-lg leading-none"
                    >
                      {creating ? "Сохранение…" : "Создать проект"}
                    </button>
                  </div>
                </motion.form>
              )}
            </AnimatePresence>
          </div>

          {projectsLoading ? (
            <div className="bg-white p-6 rounded-[20px] shadow-sm border border-gray-100">
              <p className="text-[14px] text-[#9ca3af]">Загрузка проектов…</p>
            </div>
          ) : projectsError ? (
            <div className="bg-rose-50 border border-rose-100 p-4 rounded-2xl text-[12px] text-rose-600">
              {projectsError}
            </div>
          ) : projects.length === 0 ? (
            <div className="bg-white p-8 rounded-[20px] shadow-sm border border-gray-100 text-center">
              <p className="text-[13px] text-[#9ca3af]">
                Проектов пока нет — создайте через форму выше или в чате.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {projects.map((project, idx) => {
                const uiStatus = toUiStatus(project.status);
                const days = daysSince(project.updated_at);
                const momentum = momentumFromDays(days);
                const isActive = uiStatus === "ACTIVE";
                const isStalled = uiStatus === "STALLED";
                const totalSeconds = (project.total_sessions_minutes ?? 0) * 60;

                return (
                  <div
                    key={project.id}
                    className="bg-white rounded-[20px] p-6 shadow-sm border border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-6 hover:shadow-md transition-all group"
                  >
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2.5">
                        <h3 className="text-base font-black text-gray-900 group-hover:text-indigo-600 transition-colors">
                          {project.name}
                        </h3>

                        <span
                          className={cn(
                            "text-[9px] font-black px-2 py-0.5 rounded uppercase tracking-wider",
                            isActive
                              ? "bg-green-50 text-green-600"
                              : isStalled
                                ? "bg-red-50 text-red-600"
                                : "bg-gray-100 text-gray-600"
                          )}
                        >
                          {uiStatus === "ACTIVE"
                            ? "АКТИВЕН"
                            : uiStatus === "STALLED"
                            ? "ЗАСТРЯЛ"
                            : uiStatus === "COMPLETED"
                            ? "ЗАВЕРШЁН"
                            : uiStatus === "PAUSED"
                            ? "НА ПАУЗЕ"
                            : "В АРХИВЕ"}
                        </span>
                      </div>

                      {project.description && (
                        <p className="text-xs text-gray-500 leading-relaxed font-medium">
                          {project.description}
                        </p>
                      )}

                      <div className="flex items-center gap-3 text-[11px] font-bold text-gray-400">
                        <span className="flex items-center gap-1.5">
                          <Clock size={12} className="text-slate-400" />
                          Последняя активность: {days >= 999
                            ? "—"
                            : `${days} ${
                                days % 10 === 1 && days % 100 !== 11
                                  ? "день"
                                  : days % 10 >= 2 && days % 10 <= 4 && (days % 100 < 12 || days % 100 > 14)
                                  ? "дня"
                                  : "дней"
                              } назад`}
                        </span>
                        {totalSeconds > 0 && (
                          <span className="font-mono">
                            • {formatTotalTime(totalSeconds)}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col md:items-end gap-4 min-w-[210px] pt-4 md:pt-0 border-t md:border-t-0 border-gray-50">
                      <div className="w-full space-y-1">
                        <div className="flex justify-between items-center text-[10px] font-black text-gray-400 uppercase tracking-widest">
                          <span>Импульс</span>
                          <span className="font-mono">{momentum}%</span>
                        </div>

                        <div className="h-2 w-full bg-gray-100 overflow-hidden rounded-full relative">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${momentum}%` }}
                            transition={{ duration: 1, delay: idx * 0.1 }}
                            className={cn(
                              "h-full rounded-full transition-all duration-500",
                              momentum > 50
                                ? "bg-indigo-500"
                                : momentum > 20
                                  ? "bg-amber-400"
                                  : "bg-red-500"
                            )}
                          />
                        </div>
                      </div>

                      <button
                        onClick={() => setSelectedId(project.id)}
                        className="w-full md:w-auto flex items-center justify-center gap-1 text-[11px] font-bold uppercase tracking-wider text-indigo-600 hover:text-indigo-800 bg-indigo-50/50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg border border-indigo-100/30 transition-all self-end"
                      >
                        Открыть проект →
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-6">
          <div className="bg-[#1a1a2e] rounded-[20px] p-6 shadow-sm border border-slate-800 text-white relative">
            <StatusDot color={stalledCount > 0 ? "#ef4444" : "#10b981"} />
            <div className="flex gap-3">
              <div className="shrink-0 w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center text-white shadow-md">
                <Bell size={16} />
              </div>
              <div>
                <h4 className="text-[11px] font-black tracking-widest text-[#9ca3af] uppercase">
                  Отчёт AIR4 по проектам
                </h4>
                <p className="text-[13px] leading-relaxed font-bold mt-2 text-indigo-100">
                  {projects.length === 0
                    ? `«Проектов пока нет. Создайте проект, чтобы начать отслеживать импульс и фокус-сессии.»`
                    : stalledCount > 0
                      ? `«${stalledCount} ${
                          stalledCount % 10 === 1 && stalledCount % 100 !== 11
                            ? "проект застрял"
                            : stalledCount % 10 >= 2 && stalledCount % 10 <= 4 && (stalledCount % 100 < 12 || stalledCount % 100 > 14)
                            ? "проекта застряли"
                            : "проектов застряли"
                        } на 14+ дней. Откройте один и запустите сессию.»`
                      : `«Все проекты активны. Держите темп — откройте один и запустите фокус-блок.»`}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-[20px] shadow-sm border border-gray-100">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-800">
                Активная сессия
              </h3>
            </div>

            <div className="bg-gray-50/50 p-5 rounded-xl text-center border border-dashed border-gray-200">
              <p className="text-xs font-bold text-gray-600">Активной сессии нет.</p>
              <p className="text-[11px] text-gray-400 mt-1 leading-snug">
                Откройте проект из каталога и начните отслеживать сессии разработки.
              </p>
            </div>
          </div>

          <div className="bg-white p-6 rounded-[20px] shadow-sm border border-gray-100">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles size={16} className="text-[#6366f1]" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-800">
                Распределение фокуса
              </h3>
            </div>

            <p className="text-xs text-gray-400 mt-1 leading-relaxed mb-4">
              Относительная доля усилий по активным фокус-расписаниям.
            </p>

            {focusDistribution.length === 0 ? (
              <p className="text-[11px] text-gray-400 italic">
                Запустите фокус-сессию в любом проекте, чтобы наполнить график.
              </p>
            ) : (
              <div className="space-y-4">
                {focusDistribution.map((fd, i) => (
                  <div key={`${fd.name}-${i}`} className="space-y-1.5">
                    <div className="flex justify-between items-center text-[11px] font-bold text-gray-700">
                      <span className="truncate pr-2">{fd.name}</span>
                      <span className="font-mono">{fd.percentage}%</span>
                    </div>

                    <div className="h-1.5 w-full bg-gray-100 overflow-hidden rounded-full">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${fd.percentage}%` }}
                        transition={{ duration: 1, delay: i * 0.05 }}
                        className={cn("h-full rounded-full", fd.color)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
