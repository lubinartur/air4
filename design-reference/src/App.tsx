import { useCallback, useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { ChatPanel } from "./components/ChatPanel";
import { Header } from "./components/Header";
import { Finance } from "./components/Finance";
import { Projects } from "./components/Projects";
import { Health } from "./components/Health";
import { Sport } from "./components/Sport";
import { Goals } from "./components/Goals";
import { Dilemmas } from "./components/Dilemmas";
import { Patterns } from "./components/Patterns";
import { Memory } from "./components/Memory";
import { Settings } from "./components/Settings";
import { EmptyStates } from "./components/EmptyStates";
import { Profile } from "./components/Profile";
import { ToastDemo } from "./components/ToastDemo";
import { FullscreenChat } from "./components/FullscreenChat";
import { CSVUpload } from "./components/CSVUpload";
import { OverviewDashboard } from "./components/OverviewDashboard";
import { Page } from "./types";
import { cn } from "./lib/utils";
import { motion, AnimatePresence } from "motion/react";
import {
  fetchOverviewSummary,
  getProjects,
  fetchDilemmas,
  fetchObservations,
  fetchBodyMetrics,
  fetchWorkouts,
  fetchGoals,
  fetchHypotheses,
  fetchProfile,
  generateObservations,
  pickDisplayObservation,
  type ChatResponseMeta,
  type Summary,
  type Project,
  type Dilemma,
  type Observation,
  type BodyMetric,
  type Workout,
  type GoalItem,
  type Hypothesis,
  type UserFact,
} from "./lib/api";

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>("Overview");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [dilemmas, setDilemmas] = useState<Dilemma[]>([]);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [bodyMetrics, setBodyMetrics] = useState<BodyMetric[]>([]);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [goals, setGoals] = useState<GoalItem[]>([]);
  const [hypotheses, setHypotheses] = useState<Hypothesis[]>([]);
  const [facts, setFacts] = useState<UserFact[]>([]);
  const [observationsRefreshing, setObservationsRefreshing] = useState(false);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [pendingChatMessage, setPendingChatMessage] = useState<string | null>(null);
  const [previousPage, setPreviousPage] = useState<Page>("Overview");
  const [financeRefreshTick, setFinanceRefreshTick] = useState(0);

  const openChatWithMessage = useCallback((text: string) => {
    setPendingChatMessage(text);
  }, []);

  const loadObservations = useCallback(async (tryGenerateIfStale = false) => {
    try {
      let data = await fetchObservations();
      const isEmpty = data.length === 0;
      const isStale =
        !isEmpty &&
        (() => {
          const created = data[0]?.created_at;
          if (!created) return false;
          const normalized = created.includes("T")
            ? created
            : created.replace(" ", "T") + "Z";
          const t = Date.parse(normalized);
          if (Number.isNaN(t)) return false;
          return Date.now() - t > 24 * 60 * 60 * 1000;
        })();
      if (tryGenerateIfStale && (isEmpty || isStale)) {
        try {
          const generated = await generateObservations();
          data =
            generated.observations.length > 0
              ? generated.observations
              : await fetchObservations();
        } catch {
          /* generation optional */
        }
      }
      setObservations(data);
    } catch {
      setObservations([]);
    }
  }, []);

  const refreshObservations = useCallback(async () => {
    setObservationsRefreshing(true);
    try {
      await generateObservations();
      await loadObservations(false);
    } catch {
      await loadObservations(false);
    } finally {
      setObservationsRefreshing(false);
    }
  }, [loadObservations]);

  const loadSummary = useCallback(async () => {
    try {
      setSummary(await fetchOverviewSummary());
    } catch {
      setSummary(null);
    }
  }, []);

  const loadBodyMetrics = useCallback(async () => {
    try {
      setBodyMetrics(await fetchBodyMetrics());
    } catch (err) {
      console.error("[AIR4 health] loadBodyMetrics failed", err);
      setBodyMetrics([]);
    }
  }, []);

  const loadGoals = useCallback(async () => {
    try {
      const data = await fetchGoals();
      setGoals(data.goals);
    } catch {
      setGoals([]);
    }
  }, []);

  const loadDilemmas = useCallback(async () => {
    try {
      setDilemmas(await fetchDilemmas());
    } catch {
      setDilemmas([]);
    }
  }, []);

  const loadHypotheses = useCallback(async () => {
    try {
      const data = await fetchHypotheses();
      setHypotheses(data.hypotheses);
    } catch {
      setHypotheses([]);
    }
  }, []);

  const loadFacts = useCallback(async () => {
    try {
      const bundle = await fetchProfile();
      setFacts(bundle.facts ?? []);
    } catch {
      setFacts([]);
    }
  }, []);

  // Refreshed after every chat message. Deliberately excludes the finance
  // summary: chat cannot mutate `transactions` (the only thing summary
  // reads), and `/api/summary` is the heaviest read-path query. Subscription
  // edits do touch the DB but live in their own table — Finance refetches
  // those via `financeRefreshTick` below. CSV upload triggers a summary
  // reload via `onViewFinance` on the CSVUpload page.
  const refreshOverviewData = useCallback(async () => {
    const [obsRes, metricsRes, workoutsRes, goalsRes, dilemmasRes, hypothesesRes] =
      await Promise.allSettled([
        fetchObservations(),
        fetchBodyMetrics(),
        fetchWorkouts(),
        fetchGoals(),
        fetchDilemmas(),
        fetchHypotheses(),
      ]);
    if (obsRes.status === "fulfilled") setObservations(obsRes.value);
    if (metricsRes.status === "fulfilled") setBodyMetrics(metricsRes.value);
    if (workoutsRes.status === "fulfilled") setWorkouts(workoutsRes.value);
    if (goalsRes.status === "fulfilled") setGoals(goalsRes.value.goals);
    if (dilemmasRes.status === "fulfilled") setDilemmas(dilemmasRes.value);
    if (hypothesesRes.status === "fulfilled") setHypotheses(hypothesesRes.value.hypotheses);
  }, []);

  const handleMessageSent = useCallback(
    (meta?: ChatResponseMeta) => {
      void refreshOverviewData();
      // Finance sidebar stays mounted on the Finance page; fullscreen
      // chat from Finance unmounts it but we still bump the tick so a
      // return visit shows fresh data. Always refetch recurring rows
      // after chat on Finance — fact_extractor may create obligations
      // that only appear in meta.recurring_updated after extractors run.
      const financeContext =
        currentPage === "Finance" ||
        (currentPage === "Chat" && previousPage === "Finance");
      if (
        financeContext ||
        (meta?.recurring_updated?.length ?? 0) > 0
      ) {
        setFinanceRefreshTick((tick) => tick + 1);
      }
    },
    [refreshOverviewData, currentPage, previousPage]
  );

  useEffect(() => {
    void loadSummary();
    void loadObservations(false);
    void loadBodyMetrics();
    void loadGoals();
    void loadDilemmas();
    void loadHypotheses();
    void loadFacts();
    void fetchWorkouts()
      .then(setWorkouts)
      .catch(() => setWorkouts([]));
  }, [
    loadSummary,
    loadObservations,
    loadBodyMetrics,
    loadGoals,
    loadDilemmas,
    loadHypotheses,
    loadFacts,
  ]);

  useEffect(() => {
    if (currentPage !== "Chat") {
      setPreviousPage(currentPage);
    }
  }, [currentPage]);

  // Side-loads triggered when the user actually lands on Overview.
  // Finance summary is intentionally NOT refetched here — the mount
  // effect already loaded it via `loadSummary()`, and `/api/summary` is
  // expensive. It only needs to refresh after a new CSV upload, which is
  // handled by `CSVUpload`'s `onViewFinance` callback below.
  useEffect(() => {
    if (currentPage !== "Overview") return;

    let cancelled = false;
    (async () => {
      setOverviewLoading(true);
      const [projectsRes, dilemmasRes, metricsRes, workoutsRes] =
        await Promise.allSettled([
          getProjects(),
          fetchDilemmas(),
          fetchBodyMetrics(),
          fetchWorkouts(),
        ]);

      if (!cancelled) {
        if (projectsRes.status === "fulfilled") setProjects(projectsRes.value);
        else setProjects([]);
        if (dilemmasRes.status === "fulfilled") setDilemmas(dilemmasRes.value);
        else setDilemmas([]);
        if (metricsRes.status === "fulfilled") setBodyMetrics(metricsRes.value);
        if (workoutsRes.status === "fulfilled") setWorkouts(workoutsRes.value);
      }

      if (!cancelled) {
        await loadObservations(true);
      }

      if (!cancelled) setOverviewLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [currentPage, loadObservations]);

  const openDilemma = dilemmas.find((d) => d.status === "open") ?? null;
  const activeProjects = projects.filter((p) => p.status === "active");
  const displayObservation = pickDisplayObservation(observations);
  // Derive pending follow-ups locally from the already-loaded dilemma
  // list — saves a round-trip and stays in sync with every refresh
  // path (initial load + post-chat reload). The dedicated endpoint
  // (/api/dilemmas/pending-followups) is still exposed for headless
  // consumers (widgets, mobile, etc.) that don't fetch the full list.
  const pendingFollowups = (() => {
    const todayIso = new Date().toISOString().slice(0, 10);
    return dilemmas.filter((d) => {
      if (!d.followup_due) return false;
      if (d.followup_done === true || d.followup_done === 1) return false;
      return String(d.followup_due).slice(0, 10) <= todayIso;
    });
  })();

  return (
    <div className="flex h-screen overflow-hidden bg-[#f4f5f7]">
      <Sidebar currentPage={currentPage} onPageChange={setCurrentPage} />

      <main
        className={cn(
          "flex-1 flex flex-col min-w-0 bg-[#f4f5f7]",
          currentPage !== "Chat" ? "p-8 overflow-y-auto" : "overflow-hidden"
        )}
      >
        {currentPage !== "Chat" && <Header currentPage={currentPage} />}

        <div className="flex-1 min-h-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentPage}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="h-full"
            >
              {currentPage === "Chat" ? (
                <FullscreenChat
                  onBack={() => setCurrentPage(previousPage)}
                  previousPage={previousPage}
                  summary={summary}
                  projects={projects}
                  bodyMetrics={bodyMetrics}
                  workouts={workouts}
                  dilemmas={dilemmas}
                  facts={facts}
                  onMessageSent={handleMessageSent}
                />
              ) : currentPage === "Overview" ? (
                <OverviewDashboard
                  summary={summary}
                  projects={projects}
                  observations={observations}
                  insight={displayObservation}
                  bodyMetrics={bodyMetrics}
                  workouts={workouts}
                  loading={overviewLoading}
                  openDilemma={openDilemma}
                  pendingFollowups={pendingFollowups}
                  activeProjects={activeProjects}
                  onPageChange={setCurrentPage}
                  onOpenChatWithMessage={openChatWithMessage}
                />
              ) : currentPage === "Finance" ? (
                <Finance
                  onPageChange={setCurrentPage}
                  refreshTick={financeRefreshTick}
                />
              ) : currentPage === "Projects" ? (
                <Projects />
              ) : currentPage === "Health" ? (
                <Health />
              ) : currentPage === "Sport" ? (
                <Sport />
              ) : currentPage === "Goals" ? (
                <Goals goals={goals} />
              ) : currentPage === "Dilemmas" ? (
                <Dilemmas dilemmas={dilemmas} onRefresh={loadDilemmas} />
              ) : currentPage === "Patterns" ? (
                <Patterns hypotheses={hypotheses} />
              ) : currentPage === "Memory" ? (
                <Memory />
              ) : currentPage === "Settings" ? (
                <Settings />
              ) : currentPage === "EmptyStates" ? (
                <EmptyStates />
              ) : currentPage === "Profile" ? (
                <Profile />
              ) : currentPage === "Toasts" ? (
                <ToastDemo />
              ) : currentPage === "CSVUpload" ? (
                <CSVUpload
                  onBack={() => setCurrentPage("Finance")}
                  onViewFinance={() => {
                    void loadSummary();
                    setCurrentPage("Finance");
                  }}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-gray-400">
                  {currentPage} coming soon...
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {currentPage !== "Chat" && (
        <ChatPanel
          currentPage={currentPage}
          observation={displayObservation}
          observationsRefreshing={observationsRefreshing}
          onRefreshObservations={refreshObservations}
          onMessageSent={handleMessageSent}
          pendingMessage={pendingChatMessage}
          onPendingMessageConsumed={() => setPendingChatMessage(null)}
          onExpand={() => setCurrentPage("Chat")}
        />
      )}
    </div>
  );
}
