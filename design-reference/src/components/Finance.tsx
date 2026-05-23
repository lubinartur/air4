import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  TrendingUp,
  TrendingDown,
  Upload,
  Utensils,
  ShoppingBag,
  Car,
  Zap,
  MoreHorizontal,
  Activity,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Check,
  Search,
  Tag,
  Trash2,
  Loader2,
  Landmark,
  Sparkles,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../lib/utils";
import { t } from "../lib/typography";
import { Page } from "../types";
import {
  deleteUpload,
  fetchFinanceCycles,
  fetchMonthlyFixed,
  fetchObligations,
  fetchSubscriptions,
  formatCategoryLabel,
  formatEuro,
  getSummary,
  getTransactions,
  getTransactionsRange,
  getUploads,
  hasFinanceData,
  TRANSACTION_CATEGORIES,
  updateTransactionCategory,
  type FinanceCycles,
  type FinanceObligation,
  type FinanceSubscription,
  type MonthlyFixed,
  type StatementUpload,
  type Summary,
  type Transaction,
  type TransactionCategory,
} from "../lib/api";

const StatusDot = ({ color = "#ef4444" }: { color?: string }) => (
  <div className="absolute top-3 right-3 w-4 h-4 flex items-center justify-center pointer-events-none">
    <div
      className="absolute w-4 h-4 rounded-full opacity-50 animate-ping"
      style={{ backgroundColor: color }}
    />
    <div className="relative w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
  </div>
);

const CATEGORY_ICONS: Record<string, { icon: LucideIcon; color: string }> = {
  food_restaurants: { icon: Utensils, color: "bg-red-500" },
  food_groceries: { icon: ShoppingBag, color: "bg-emerald-500" },
  transport: { icon: Car, color: "bg-blue-500" },
  subscriptions: { icon: Zap, color: "bg-amber-500" },
  health: { icon: Activity, color: "bg-teal-500" },
  shopping: { icon: CreditCard, color: "bg-indigo-500" },
  transfers: { icon: MoreHorizontal, color: "bg-gray-400" },
  // `loan_payment` is real spending (mortgage / consumer loan instalments),
  // distinct from neutral `repayment`/`transfers`. Indigo matches the
  // "Кредиты и обязательства" sidebar accent so the chart row visually
  // ties back to the obligation it decrements.
  loan_payment: { icon: Landmark, color: "bg-indigo-500" },
  utilities: { icon: Zap, color: "bg-sky-500" },
  entertainment: { icon: Activity, color: "bg-purple-500" },
  other: { icon: MoreHorizontal, color: "bg-gray-300" },
};

function categoryMeta(key: string) {
  return (
    CATEGORY_ICONS[key] ?? {
      icon: MoreHorizontal,
      color: "bg-gray-300",
    }
  );
}

// "Neutral" categories — real money movement, but neither income nor expense
// (debt repayments, transfers in/out). The backend excludes them from
// `total_spent` (see `NEUTRAL_CATEGORIES` in `services/summary_loader.py`),
// and the UI hides them from the spending chart so the breakdown reflects
// real lifestyle consumption. The CategoryReview dropdown still exposes them
// — visibly muted — so the user can recategorize misclassified rows.
const NEUTRAL_CATEGORIES = new Set<string>([
  "repayment",
  "internal_transfer",
  "internal_transfers",
  "transfers",
]);

// Hide neutral + aggregate buckets from the «Структура трат» chart. The
// `internal_transfers` row is re-injected separately below with an explicit
// "не реальные траты" hint so users still see the volume.
const HIDDEN_CATEGORIES = new Set<string>([
  "repayment",
  "internal_transfer",
  "internal_transfers",
  "transfers",
]);

function formatTxDate(iso: string): string {
  const d = new Date(iso.includes("T") ? iso : `${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function formatUploadDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatPeriod(start: string | null | undefined, end: string | null | undefined): string {
  if (start && end) return `${start} — ${end}`;
  if (start) return start;
  if (end) return end;
  return "—";
}

function formatCycleEdge(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Salary cycle starts on the 10th. Given a cycle-start ISO, return the
 *  start of the previous cycle (subtract 1 month, handle Jan → Dec). */
function prevCycleStart(startIso: string): string {
  const [y, m] = startIso.split("-").map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, "0")}-10`;
}

/** Start of the next cycle (add 1 month). */
function nextCycleStart(startIso: string): string {
  const [y, m] = startIso.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-10`;
}

/** Cycle end is the 9th of the next month after `startIso`. */
function cycleEndFromStart(startIso: string): string {
  const [y, m] = startIso.split("-").map(Number);
  const ey = m === 12 ? y + 1 : y;
  const em = m === 12 ? 1 : m + 1;
  return `${ey}-${String(em).padStart(2, "0")}-09`;
}

function ChatEmpty({ label }: { label: string }) {
  return (
    <p className="text-[13px] text-[#9ca3af] font-medium py-4 text-center">
      {label}
      <span className="block text-[11px] mt-1 text-[#d1d5db]">Добавить через чат</span>
    </p>
  );
}

/** Resolve a recurring `billing_day` (1-31) to the next calendar date
 *  on or after today. Returns null when the day is missing/invalid. */
function nextBillingDate(
  billingDay: number | null | undefined,
  today: Date = new Date()
): Date | null {
  if (billingDay == null || !Number.isFinite(billingDay)) return null;
  const day = Math.max(1, Math.min(28, Math.trunc(billingDay)));
  const y = today.getFullYear();
  const m = today.getMonth();
  const todayDay = today.getDate();
  return todayDay <= day ? new Date(y, m, day) : new Date(y, m + 1, day);
}

/** Pull a day-of-month out of an obligation's `due_date` field, which is a
 *  free-form text column. Accepts ISO YYYY-MM-DD or a bare 1-2 digit number. */
function parseDueDay(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return Number(iso[3]);
  const day = /^(\d{1,2})$/.exec(s);
  if (day) {
    const n = Number(day[1]);
    return n >= 1 && n <= 31 ? n : null;
  }
  return null;
}

function formatRelativeDate(date: Date, today: Date = new Date()): string {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((date.getTime() - start.getTime()) / 86_400_000);
  if (days <= 0) return "сегодня";
  if (days === 1) return "завтра";
  if (days < 7) return `через ${days} дн`;
  return date.toLocaleDateString("ru-RU", { month: "short", day: "numeric" });
}

/** Pick a Tailwind class set for a loan progress bar based on % paid.
 *  Mostly paid → green; halfway → indigo; mostly remaining → red. */
function progressTone(percentPaid: number): {
  bar: string;
  text: string;
  badge: string;
} {
  if (percentPaid >= 70) {
    return {
      bar: "bg-emerald-500",
      text: "text-emerald-600",
      badge: "bg-emerald-50 text-emerald-700",
    };
  }
  if (percentPaid >= 35) {
    return {
      bar: "bg-indigo-500",
      text: "text-indigo-600",
      badge: "bg-indigo-50 text-indigo-700",
    };
  }
  return {
    bar: "bg-red-500",
    text: "text-red-600",
    badge: "bg-red-50 text-red-700",
  };
}

const CUSTOM_CATEGORIES_STORAGE_KEY = "air4.customCategories.v1";
const NEW_CATEGORY_SENTINEL = "__new__";

/** Read the user's custom-category list from localStorage. Defensive: bad
 *  payloads are wiped silently so a poisoned key doesn't break the page. */
function loadCustomCategories(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_CATEGORIES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((v) => (typeof v === "string" ? v : ""))
      .filter((v) => /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/.test(v));
  } catch {
    return [];
  }
}

function saveCustomCategories(list: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      CUSTOM_CATEGORIES_STORAGE_KEY,
      JSON.stringify(list)
    );
  } catch {
    /* quota / privacy mode — ignore */
  }
}

/** Convert any user input ("Pet Care", "Подарки", "tax & fees") into a slug
 *  the backend validator accepts. Cyrillic and other non-ascii letters are
 *  dropped, so users entering Russian get a hint to try latin. */
function slugifyCategory(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

/** Categorization review modal: lists every transaction in the active cycle
 *  so the user can fix mis-classified rows. PUT /api/transactions/{id}/category
 *  flips `category_confirmed` so the auto-categorizer never reverts the row.
 *  Custom categories are persisted in localStorage and merged into both the
 *  filter and per-row dropdowns.
 */
function CategoryReview({
  open,
  onClose,
  cycleStart,
  cycleEnd,
  onCategoryChanged,
}: {
  open: boolean;
  onClose: () => void;
  cycleStart: string | null;
  cycleEnd: string | null;
  onCategoryChanged?: () => void;
}) {
  const [items, setItems] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set of transaction ids currently saving — allows multiple rows in flight
  // simultaneously instead of serializing through a single `savingId`.
  const [savingIds, setSavingIds] = useState<ReadonlySet<number>>(
    () => new Set()
  );
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  // Track whether anything was actually saved during this open session. We
  // only call `onCategoryChanged` once on close (and only if dirty) instead
  // of after every PUT — the parent's summary refetch was causing a render
  // storm in `Finance` that froze the UI mid-edit.
  const dirtyRef = useRef(false);

  // Per-row debounce timers so a fast cycle through the dropdown only fires
  // one PUT for the final value. Optimistic local update happens immediately.
  const debounceRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(
    new Map()
  );

  // Custom categories: a user-extensible list kept in localStorage. Merged
  // into both filter & per-row dropdowns. `creatingFor` tracks the row that
  // is currently in "type a new category name" mode.
  const [customCategories, setCustomCategories] = useState<string[]>(() =>
    loadCustomCategories()
  );
  const [creatingFor, setCreatingFor] = useState<number | null>(null);
  const [draftName, setDraftName] = useState("");
  const draftInputRef = useRef<HTMLInputElement | null>(null);

  // All categories the user can pick from = canonical list + their custom
  // additions, with the canonical "other" pinned to the bottom of the
  // canonical block. Dedup so duplicates from old saves can't double up.
  const allCategories = useMemo(() => {
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const cat of TRANSACTION_CATEGORIES) {
      if (!seen.has(cat)) {
        seen.add(cat);
        merged.push(cat);
      }
    }
    for (const cat of customCategories) {
      if (!seen.has(cat)) {
        seen.add(cat);
        merged.push(cat);
      }
    }
    return merged;
  }, [customCategories]);

  const reload = useCallback(async () => {
    if (!cycleStart || !cycleEnd) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const page = await getTransactionsRange({
        start: cycleStart,
        end: cycleEnd,
        limit: 500,
      });
      setItems(page.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить транзакции");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [cycleStart, cycleEnd]);

  // Fetch when the modal opens, refetch when the cycle changes while open.
  useEffect(() => {
    if (!open) return;
    void reload();
  }, [open, reload]);

  // Reset transient UI state every time the modal closes so re-opening is
  // a clean slate (filters preserved, but row-level edits are not).
  useEffect(() => {
    if (open) return;
    setCreatingFor(null);
    setDraftName("");
    setError(null);
    // Clear any pending debounced saves — items state is already optimistic,
    // and the parent will refetch summary on close-if-dirty.
    for (const handle of debounceRef.current.values()) clearTimeout(handle);
    debounceRef.current.clear();
  }, [open]);

  // Auto-focus the inline input when entering "create new category" mode.
  useEffect(() => {
    if (creatingFor != null) {
      draftInputRef.current?.focus();
    }
  }, [creatingFor]);

  // Cleanup debounce timers if the component unmounts while open.
  useEffect(() => {
    const map = debounceRef.current;
    return () => {
      for (const handle of map.values()) clearTimeout(handle);
      map.clear();
    };
  }, []);

  const persistCustomCategory = useCallback((slug: string) => {
    setCustomCategories((prev) => {
      if (prev.includes(slug)) return prev;
      const next = [...prev, slug];
      saveCustomCategories(next);
      return next;
    });
  }, []);

  /** Send the PUT for `transaction → next`. Items state is already optimistic
   *  by the time we get here (see `handleSelectChange`). On error we revert
   *  the row to its pre-edit state and surface the error. */
  const sendCategoryUpdate = useCallback(
    async (transaction: Transaction, next: string, previous: Transaction) => {
      setSavingIds((prev) => {
        const ns = new Set(prev);
        ns.add(transaction.id);
        return ns;
      });
      try {
        const updated = await updateTransactionCategory(transaction.id, next);
        setItems((prev) =>
          prev.map((row) =>
            row.id === transaction.id ? { ...row, ...updated } : row
          )
        );
        dirtyRef.current = true;
      } catch (e) {
        // Roll back the optimistic update so the dropdown reflects reality.
        setItems((prev) =>
          prev.map((row) => (row.id === transaction.id ? previous : row))
        );
        setError(
          e instanceof Error ? e.message : "Не удалось сохранить категорию"
        );
      } finally {
        setSavingIds((prev) => {
          const ns = new Set(prev);
          ns.delete(transaction.id);
          return ns;
        });
      }
    },
    []
  );

  /** Apply optimistic local update, then schedule a debounced PUT (200ms).
   *  If the user changes the same row again before the timer fires, we
   *  reset and only send the final value. */
  const scheduleSave = useCallback(
    (transaction: Transaction, next: string) => {
      const slug = next.trim().toLowerCase();
      if (!slug || slug === NEW_CATEGORY_SENTINEL) return;
      if (slug === transaction.category) {
        // No-op: avoid PUT-spam when the user re-selects the same value.
        // The "confirmed" badge already handles the explicit-confirm case
        // for transactions that aren't yet confirmed.
        if (transaction.category_confirmed) return;
      }

      // Snapshot the original row for rollback on error.
      const previous = transaction;

      // Optimistic update — UI feels instant.
      setItems((prev) =>
        prev.map((row) =>
          row.id === transaction.id
            ? { ...row, category: slug, category_confirmed: true }
            : row
        )
      );

      // Reset any pending timer for this row, then schedule the actual PUT.
      const map = debounceRef.current;
      const existing = map.get(transaction.id);
      if (existing) clearTimeout(existing);
      const handle = setTimeout(() => {
        map.delete(transaction.id);
        void sendCategoryUpdate(transaction, slug, previous);
      }, 200);
      map.set(transaction.id, handle);
    },
    [sendCategoryUpdate]
  );

  const handleCommitDraft = useCallback(
    async (transaction: Transaction) => {
      const slug = slugifyCategory(draftName);
      if (!slug) {
        setError(
          "Введите название латиницей (a–z, цифры, подчёркивания)."
        );
        return;
      }
      persistCustomCategory(slug);
      setCreatingFor(null);
      setDraftName("");
      // Drafts are explicit, fire immediately (no debounce).
      const previous = transaction;
      setItems((prev) =>
        prev.map((row) =>
          row.id === transaction.id
            ? { ...row, category: slug, category_confirmed: true }
            : row
        )
      );
      await sendCategoryUpdate(transaction, slug, previous);
    },
    [draftName, persistCustomCategory, sendCategoryUpdate]
  );

  const handleSelectChange = useCallback(
    (transaction: Transaction, value: string) => {
      if (value === NEW_CATEGORY_SENTINEL) {
        setCreatingFor(transaction.id);
        setDraftName("");
        setError(null);
        return;
      }
      scheduleSave(transaction, value);
    },
    [scheduleSave]
  );

  /** Wrapper around the parent-supplied `onClose` that flushes any pending
   *  debounced saves, then notifies the parent (once, if anything changed)
   *  to refetch summary/transactions. Keeps the per-PUT path off of
   *  `Finance`'s render path so changes feel instant. */
  const handleClose = useCallback(() => {
    // Flush pending debounced saves so we don't lose them. We don't await —
    // the local state already reflects the optimistic value, and the parent
    // will still get its refresh signal.
    for (const [id, handle] of debounceRef.current) {
      clearTimeout(handle);
      const tx = items.find((row) => row.id === id);
      if (tx && tx.category) {
        void sendCategoryUpdate(tx, tx.category, tx);
      }
    }
    debounceRef.current.clear();

    if (dirtyRef.current) {
      onCategoryChanged?.();
      dirtyRef.current = false;
    }
    onClose();
  }, [items, onCategoryChanged, onClose, sendCategoryUpdate]);

  // Close on Escape — wired after `handleClose` is defined.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, handleClose]);

  const counts = useMemo(() => {
    let total = 0;
    let needsReview = 0;
    for (const tx of items) {
      total += 1;
      if (
        !tx.category_confirmed &&
        (!tx.category || tx.category === "other")
      ) {
        needsReview += 1;
      }
    }
    return { total, needsReview };
  }, [items]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((tx) => {
      if (filter === "needs_review") {
        if (tx.category_confirmed) return false;
        const cat = tx.category ?? "";
        if (cat && cat !== "other") return false;
      } else if (filter !== "all") {
        if ((tx.category ?? "") !== filter) return false;
      }
      if (q) {
        const desc = (tx.description ?? "").toLowerCase();
        if (!desc.includes(q)) return false;
      }
      return true;
    });
  }, [items, filter, search]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={handleClose}
          role="presentation"
        >
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="relative bg-white rounded-[24px] shadow-2xl w-full max-w-5xl max-h-[88vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                  <Tag size={16} />
                </div>
                <div>
                  <h2 className="text-[17px] font-black text-gray-900 leading-tight">
                    Проверка категорий
                  </h2>
                  <p className="text-[12px] text-gray-600 mt-0.5">
                    {counts.total > 0
                      ? `${counts.total} транзакций · ${counts.needsReview} требуют внимания`
                      : "Просмотрите автокатегории и исправьте неверные"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleClose}
                aria-label="Закрыть"
                className="w-9 h-9 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Toolbar */}
            <div className="px-6 py-4 border-b border-gray-100 flex flex-wrap gap-3 items-center">
              <div className="relative flex-1 min-w-[200px]">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                />
                <input
                  type="text"
                  placeholder="Поиск по контрагенту..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-100 rounded-lg text-[13px] font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500/50 text-gray-800"
                />
              </div>
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="px-3 py-2 bg-gray-50 border border-gray-100 rounded-lg text-[13px] font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500/50 text-gray-800"
              >
                <option value="all">Все категории</option>
                <option value="needs_review">Требуют внимания (other)</option>
                <option disabled>──────────</option>
                {allCategories.map((cat) => {
                  const isNeutral = NEUTRAL_CATEGORIES.has(cat);
                  return (
                    <option
                      key={cat}
                      value={cat}
                      title={isNeutral ? "Не считается расходом" : undefined}
                      className={isNeutral ? "text-gray-400" : undefined}
                    >
                      {formatCategoryLabel(cat)}
                      {isNeutral ? " · нейтральная" : ""}
                    </option>
                  );
                })}
              </select>
              <button
                type="button"
                onClick={() => void reload()}
                disabled={loading}
                className="px-3 py-2 text-[12px] font-bold uppercase tracking-wider text-gray-600 bg-gray-50 hover:bg-gray-100 border border-gray-100 rounded-lg disabled:opacity-50 transition-colors"
              >
                {loading ? "Загрузка..." : "Обновить"}
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {error && (
                <p className="text-[12px] text-rose-600 font-medium mb-3">
                  {error}
                </p>
              )}

              {loading && items.length === 0 ? (
                <p className="text-[14px] text-[#9ca3af] py-12 text-center">
                  Загрузка транзакций...
                </p>
              ) : visible.length === 0 ? (
                <p className="text-[14px] text-[#9ca3af] py-12 text-center">
                  {items.length === 0
                    ? "Транзакций в этом цикле нет."
                    : "По текущему фильтру ничего не найдено."}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-white z-10">
                      <tr className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                        <th className="pb-3 pr-2">Дата</th>
                        <th className="pb-3 pr-2">Контрагент</th>
                        <th className="pb-3 pr-2 text-right">Сумма</th>
                        <th className="pb-3 pr-2">Категория</th>
                        <th className="pb-3 w-8" aria-label="Подтверждено" />
                      </tr>
                    </thead>
                    <tbody className="text-[13px]">
                      {visible.map((tx, i) => {
                        const isIncome = !tx.is_debit;
                        const signed = isIncome ? tx.amount : -tx.amount;
                        const currentCategory = tx.category ?? "other";
                        const meta = categoryMeta(currentCategory);
                        const Icon = meta.icon;
                        const isSaving = savingIds.has(tx.id);
                        const confirmed = !!tx.category_confirmed;
                        const isUnreviewed =
                          !confirmed && (!tx.category || tx.category === "other");
                        const isCreating = creatingFor === tx.id;
                        // Ensure the current category (e.g. legacy or custom)
                        // is rendered in the dropdown even if it's missing
                        // from `allCategories`.
                        const dropdownOptions = allCategories.includes(
                          currentCategory
                        )
                          ? allCategories
                          : [...allCategories, currentCategory];
                        return (
                          <tr
                            key={tx.id}
                            className={cn(
                              "group border-t border-gray-50",
                              i % 2 === 0 ? "bg-gray-50/30" : "bg-white",
                              isUnreviewed && "bg-amber-50/40"
                            )}
                          >
                            <td className="py-3 pr-2 font-mono text-gray-600 whitespace-nowrap">
                              {formatTxDate(tx.date)}
                            </td>
                            <td
                              className="py-3 pr-2 font-bold text-gray-900 max-w-[280px] truncate"
                              title={tx.description ?? ""}
                            >
                              {tx.description || "—"}
                            </td>
                            <td
                              className={cn(
                                "py-3 pr-2 font-mono font-bold text-right whitespace-nowrap",
                                isIncome ? "text-green-600" : "text-gray-900"
                              )}
                            >
                              {signed > 0 ? "+" : ""}
                              {formatEuro(Math.abs(signed))}
                            </td>
                            <td className="py-3 pr-2">
                              <div className="flex items-center gap-2">
                                <div
                                  className={cn(
                                    "w-5 h-5 rounded-md flex items-center justify-center text-white shrink-0",
                                    meta.color
                                  )}
                                >
                                  <Icon size={11} />
                                </div>
                                {isCreating ? (
                                  <div className="flex items-center gap-1.5">
                                    <input
                                      ref={draftInputRef}
                                      type="text"
                                      placeholder="например, pet_care"
                                      value={draftName}
                                      onChange={(e) =>
                                        setDraftName(e.target.value)
                                      }
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                          e.preventDefault();
                                          void handleCommitDraft(tx);
                                        } else if (e.key === "Escape") {
                                          e.preventDefault();
                                          setCreatingFor(null);
                                          setDraftName("");
                                        }
                                      }}
                                      disabled={isSaving}
                                      className="w-[160px] px-2 py-1 bg-white border border-indigo-300 rounded text-[12px] font-bold focus:outline-none focus:ring-1 focus:ring-indigo-500 text-gray-800 disabled:opacity-50"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => void handleCommitDraft(tx)}
                                      disabled={isSaving || !draftName.trim()}
                                      title="Сохранить (Enter)"
                                      className="w-6 h-6 rounded text-emerald-600 hover:bg-emerald-50 disabled:opacity-40 flex items-center justify-center"
                                    >
                                      <Check size={14} strokeWidth={3} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setCreatingFor(null);
                                        setDraftName("");
                                      }}
                                      title="Отмена (Esc)"
                                      className="w-6 h-6 rounded text-gray-400 hover:bg-gray-100 flex items-center justify-center"
                                    >
                                      <X size={14} />
                                    </button>
                                  </div>
                                ) : (
                                  <select
                                    value={currentCategory}
                                    onChange={(e) =>
                                      handleSelectChange(tx, e.target.value)
                                    }
                                    disabled={isSaving}
                                    title={
                                      NEUTRAL_CATEGORIES.has(currentCategory)
                                        ? "Не считается расходом"
                                        : undefined
                                    }
                                    className={cn(
                                      "bg-transparent border border-gray-200 rounded px-2 py-1 text-[12px] font-bold focus:outline-none focus:ring-1 focus:ring-indigo-500/50 disabled:opacity-50 cursor-pointer hover:border-gray-300 transition-colors",
                                      NEUTRAL_CATEGORIES.has(currentCategory)
                                        ? "text-gray-400 italic"
                                        : "text-gray-700"
                                    )}
                                  >
                                    {dropdownOptions.map((cat) => {
                                      const isNeutral =
                                        NEUTRAL_CATEGORIES.has(cat);
                                      return (
                                        <option
                                          key={cat}
                                          value={cat}
                                          title={
                                            isNeutral
                                              ? "Не считается расходом"
                                              : undefined
                                          }
                                          className={
                                            isNeutral
                                              ? "text-gray-400"
                                              : undefined
                                          }
                                        >
                                          {formatCategoryLabel(cat)}
                                          {isNeutral ? " · нейтральная" : ""}
                                        </option>
                                      );
                                    })}
                                    <option disabled>──────────</option>
                                    <option value={NEW_CATEGORY_SENTINEL}>
                                      + Новая категория
                                    </option>
                                  </select>
                                )}
                              </div>
                            </td>
                            <td className="py-3 w-8 text-center">
                              {isSaving ? (
                                <Loader2
                                  size={14}
                                  className="text-gray-400 animate-spin inline-block"
                                />
                              ) : confirmed ? (
                                <span
                                  title="Категория подтверждена"
                                  className="inline-flex w-5 h-5 rounded-full bg-emerald-100 text-emerald-600 items-center justify-center"
                                >
                                  <Check size={12} strokeWidth={3} />
                                </span>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Finance({
  onPageChange,
  refreshTick = 0,
}: {
  onPageChange: (page: Page) => void;
  refreshTick?: number;
}) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [uploads, setUploads] = useState<StatementUpload[]>([]);
  const [subscriptions, setSubscriptions] = useState<FinanceSubscription[]>([]);
  const [obligations, setObligations] = useState<FinanceObligation[]>([]);
  const [monthlyFixed, setMonthlyFixed] = useState<MonthlyFixed | null>(null);
  const [cycles, setCycles] = useState<FinanceCycles | null>(null);
  const [cycleStart, setCycleStart] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  const cycleEnd = cycleStart ? cycleEndFromStart(cycleStart) : null;

  /** Load everything that isn't cycle-scoped (transactions list, uploads,
   *  recurring items) + the cycle metadata. */
  const loadStaticData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [
      cyclesRes,
      txRes,
      uploadsRes,
      subsRes,
      obsRes,
      fixedRes,
    ] = await Promise.allSettled([
      fetchFinanceCycles(),
      getTransactions(10),
      getUploads(),
      fetchSubscriptions(),
      fetchObligations(),
      fetchMonthlyFixed(),
    ]);

    const failed: string[] = [];

    if (cyclesRes.status === "fulfilled") {
      setCycles(cyclesRes.value);
      // Default to latest cycle that actually has data, fall back to today's
      // active cycle when no transactions exist yet.
      const initial =
        cyclesRes.value.latest_with_data?.start ?? cyclesRes.value.active.start;
      setCycleStart((prev) => prev ?? initial);
    } else {
      setCycles(null);
      failed.push("cycles");
    }

    if (txRes.status === "fulfilled") {
      setTransactions(txRes.value.items);
    } else {
      setTransactions([]);
      failed.push("transactions");
    }

    if (uploadsRes.status === "fulfilled") {
      setUploads(uploadsRes.value);
    } else {
      setUploads([]);
      failed.push("uploads");
    }

    if (subsRes.status === "fulfilled") {
      setSubscriptions(subsRes.value.subscriptions);
    } else {
      setSubscriptions([]);
    }

    if (obsRes.status === "fulfilled") {
      setObligations(obsRes.value.obligations);
    } else {
      setObligations([]);
    }

    if (fixedRes.status === "fulfilled") {
      setMonthlyFixed(fixedRes.value);
    } else {
      setMonthlyFixed(null);
    }

    if (failed.length > 0) {
      setError(`Не удалось загрузить: ${failed.join(", ")}`);
    }

    setLoading(false);
  }, []);

  /** Refetch summary whenever the selected cycle changes. */
  useEffect(() => {
    if (!cycleStart || !cycleEnd) return;
    let cancelled = false;
    void getSummary(cycleStart, cycleEnd)
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch(() => {
        if (!cancelled) setSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [cycleStart, cycleEnd]);

  useEffect(() => {
    void loadStaticData();
  }, [loadStaticData]);

  /** Refetch subscriptions / obligations / monthly-fixed when the chat
   *  reports that a recurring item was updated or deleted. Skip the initial
   *  mount (tick === 0) since loadStaticData already covers that. */
  useEffect(() => {
    if (refreshTick === 0) return;
    let cancelled = false;
    void Promise.allSettled([
      fetchSubscriptions(),
      fetchObligations(),
      fetchMonthlyFixed(),
    ]).then(([subsRes, obsRes, fixedRes]) => {
      if (cancelled) return;
      if (subsRes.status === "fulfilled") {
        setSubscriptions(subsRes.value.subscriptions);
      }
      if (obsRes.status === "fulfilled") {
        setObligations(obsRes.value.obligations);
      }
      if (fixedRes.status === "fulfilled") {
        setMonthlyFixed(fixedRes.value);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  const canGoForward = Boolean(
    cycleStart && cycles && cycleStart < cycles.active.start
  );
  const canGoBack = Boolean(
    cycleStart &&
      cycles?.earliest_with_data &&
      cycleStart > cycles.earliest_with_data.start
  );

  const handlePrevCycle = () => {
    if (!cycleStart || !canGoBack) return;
    setCycleStart(prevCycleStart(cycleStart));
  };

  const handleNextCycle = () => {
    if (!cycleStart || !canGoForward) return;
    setCycleStart(nextCycleStart(cycleStart));
  };

  const handleDeleteUpload = async (uploadId: number) => {
    if (!window.confirm("Удалить эту выписку и все её транзакции?")) return;
    setDeletingId(uploadId);
    setError(null);
    try {
      await deleteUpload(uploadId);
      await loadStaticData();
      if (cycleStart && cycleEnd) {
        try {
          setSummary(await getSummary(cycleStart, cycleEnd));
        } catch {
          setSummary(null);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось удалить выписку");
    } finally {
      setDeletingId(null);
    }
  };

  const hasData =
    hasFinanceData(summary) ||
    transactions.length > 0 ||
    uploads.length > 0;

  const categories = useMemo(() => {
    if (!summary?.by_category) return [];
    const entries = Object.entries(summary.by_category)
      .filter(([key]) => !HIDDEN_CATEGORIES.has(key))
      .sort((a, b) => b[1].amount - a[1].amount);
    const max = entries[0]?.[1].amount ?? 1;
    const rows = entries.map(([key, val]) => {
      const meta = categoryMeta(key);
      return {
        key,
        name: formatCategoryLabel(key),
        amount: val.amount,
        count: val.count,
        percent: Math.round((val.amount / max) * 100),
        icon: meta.icon,
        color: meta.color,
        highlight: key === "subscriptions" || key === "food_restaurants",
        isInternal: false,
      };
    });

    const internal = summary.internal_transfers;
    if (internal && internal.count > 0) {
      const scale = Math.max(max, internal.amount, 1);
      rows.push({
        key: "internal_transfers",
        name: "Внутренние переводы",
        amount: internal.amount,
        count: internal.count,
        percent: Math.round((internal.amount / scale) * 100),
        icon: MoreHorizontal,
        color: "bg-gray-300",
        highlight: false,
        isInternal: true,
      });
    }

    return rows;
  }, [summary]);

  const income = summary?.total_income ?? 0;
  const spent = summary?.total_spent ?? 0;
  const otherIncoming = summary?.other_incoming ?? null;
  const freeCapital = income - spent;

  /** Merge subscriptions + obligations into a single chronological list of
   *  next payments. Items without a usable day-of-month are skipped. */
  const upcomingPayments = useMemo(() => {
    const today = new Date();
    type Upcoming = {
      key: string;
      kind: "subscription" | "obligation";
      name: string;
      amount: number | null;
      date: Date;
    };
    const items: Upcoming[] = [];

    for (const s of subscriptions) {
      const date = nextBillingDate(s.billing_day, today);
      if (!date) continue;
      items.push({
        key: `sub-${s.id}`,
        kind: "subscription",
        name: s.name,
        amount: s.amount,
        date,
      });
    }

    for (const o of obligations) {
      const day = parseDueDay(o.due_date);
      const date = nextBillingDate(day, today);
      if (!date) continue;
      items.push({
        key: `obl-${o.id}`,
        kind: "obligation",
        name: o.name,
        amount: o.monthly_payment,
        date,
      });
    }

    items.sort((a, b) => a.date.getTime() - b.date.getTime());
    return items.slice(0, 6);
  }, [subscriptions, obligations]);

  return (
    <div className="flex flex-col gap-8 pb-10">
      {/* Page header sits directly on the gray page background so
          switching from Overview → Finance doesn't feel like swapping
          a transparent banner for a heavy white card. Title is bumped
          to text-4xl to match the h1 the global <Header /> renders on
          Overview ("Обзор"); the gap before the next card is provided
          by the parent flex-col gap-8 wrapper, so no margin is set
          here. */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-green-50 text-green-600 rounded-xl">
            <Wallet size={22} className="fill-green-100" />
          </div>
          <div>
            <h1 className={cn(t.pageTitle, "text-4xl")}>
              Финансовый обзор
            </h1>
            <p className={cn(t.pageSub, "mt-0.5")}>
              Расходы, доходы и финансовый трекинг
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 bg-green-50/50 border border-green-100 px-3.5 py-1.5 rounded-xl">
            <Sparkles size={14} className="text-green-600" />
            <span className="text-xs font-bold text-green-700">Финансовый советник</span>
          </div>

          <button
            type="button"
            onClick={() => onPageChange("CSVUpload")}
            className="flex items-center gap-2 bg-[#6366f1] text-white px-4 py-2 rounded-xl font-bold text-[12px] shadow-md shadow-indigo-500/20 hover:bg-indigo-700 transition-all uppercase tracking-wider"
          >
            <Upload size={14} />
            Загрузить выписку
          </button>
        </div>
      </div>

      {error && (
        <p className="text-[14px] text-red-500 bg-red-50 px-4 py-3 rounded-xl">{error}</p>
      )}

      {loading ? (
        <p className="text-[14px] text-[#9ca3af]">Загрузка…</p>
      ) : !hasData ? (
        <div className="bg-white rounded-[20px] p-12 shadow-[0_2px_12px_rgba(0,0,0,0.08)] text-center">
          <p className="text-[16px] font-bold text-[#111827]">Выписки пока не загружены</p>
          <p className="text-[13px] text-[#9ca3af] mt-2">
            Загрузите CSV Swedbank, чтобы увидеть свои финансы.
          </p>
          <button
            type="button"
            onClick={() => onPageChange("CSVUpload")}
            className="mt-6 inline-flex items-center gap-2 bg-[#6366f1] text-white px-5 py-2.5 rounded-[10px] font-bold text-[13px]"
          >
            <Upload size={16} />
            Загрузить выписку
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-5 gap-6">
          <div className="col-span-3 space-y-6">
            <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
              <div className="flex items-center justify-between gap-4 mb-6">
                <h2 className="text-lg font-extrabold text-gray-900">
                  Срез месяца
                </h2>
                {cycleStart && cycleEnd && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handlePrevCycle}
                      disabled={!canGoBack}
                      aria-label="Предыдущий цикл"
                      className="p-1 rounded-full text-gray-500 hover:bg-gray-100 hover:text-indigo-600 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-500 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <span className="text-[11px] font-bold text-gray-700 font-mono tabular-nums tracking-wide min-w-[120px] text-center">
                      {formatCycleEdge(cycleStart)} – {formatCycleEdge(cycleEnd)}
                    </span>
                    <button
                      type="button"
                      onClick={handleNextCycle}
                      disabled={!canGoForward}
                      aria-label="Следующий цикл"
                      className="p-1 rounded-full text-gray-500 hover:bg-gray-100 hover:text-indigo-600 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-500 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-8">
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Доход</p>
                  <p className="font-mono text-2xl font-bold text-gray-900">{formatEuro(income)}</p>
                  <p className="text-[10px] font-bold text-gray-300 uppercase tracking-wider mt-1">
                    Зарплата и доверенные источники
                  </p>
                  {otherIncoming && otherIncoming.amount > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-100">
                      <p className="text-[10px] font-bold text-gray-400 uppercase mb-0.5">
                        Прочие поступления
                      </p>
                      <p className="font-mono text-[15px] font-semibold text-gray-500">
                        {formatEuro(otherIncoming.amount)}
                        <span className="ml-1.5 text-[10px] font-medium text-gray-400">
                          ({otherIncoming.count})
                        </span>
                      </p>
                      <p className="text-[10px] text-gray-600 mt-0.5">
                        Переводы, возвраты — не учитываются в свободном капитале
                      </p>
                    </div>
                  )}
                </div>
                <div className="bg-indigo-50/50 p-4 rounded-2xl border border-indigo-100/50">
                  <p className="text-[10px] font-bold text-indigo-400 uppercase mb-1">
                    Свободный капитал
                  </p>
                  <div className="flex items-center gap-2 text-indigo-600">
                    <p className="font-mono text-3xl font-black">{formatEuro(freeCapital)}</p>
                    {freeCapital >= 0 ? (
                      <TrendingUp size={20} />
                    ) : (
                      <TrendingDown size={20} className="text-red-500" />
                    )}
                  </div>
                  <p className="text-[10px] font-black text-indigo-600/60 uppercase mt-1">
                    Доход − расходы
                  </p>
                  <p className="text-[10px] text-[#9ca3af] mt-2">Потрачено: {formatEuro(spent)}</p>
                  {monthlyFixed && monthlyFixed.fixed_total > 0 && (
                    <p className="text-[10px] text-[#9ca3af] mt-1">
                      Постоянные расходы: {formatEuro(monthlyFixed.fixed_total)}/мес
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)] relative">
              {categories.length > 0 && <StatusDot color="#ef4444" />}
              <div className="flex items-start justify-between gap-3 mb-6">
                <h2 className="text-lg font-extrabold text-gray-900">
                  Структура трат
                </h2>
                <button
                  type="button"
                  onClick={() => setReviewOpen(true)}
                  className="shrink-0 mr-7 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 px-2.5 py-1 rounded-md transition-colors"
                  title="Открыть проверку категорий"
                >
                  <Tag size={11} />
                  Проверить категории
                </button>
              </div>
              {categories.length === 0 ? (
                <p className="text-[14px] text-[#9ca3af]">Категорий расходов пока нет.</p>
              ) : (
                <div className="space-y-5">
                  {categories.map((cat) => (
                    <div key={cat.key} className="space-y-2">
                      <div className="flex justify-between items-center text-[13px] font-medium">
                        <div
                          className={cn(
                            "flex items-center gap-2",
                            cat.isInternal ? "text-gray-400" : "text-gray-700"
                          )}
                        >
                          <cat.icon
                            size={16}
                            className={cn(
                              cat.highlight ? "text-amber-500" : "text-gray-400"
                            )}
                          />
                          {cat.name}
                          <span className="text-[10px] text-[#9ca3af]">({cat.count})</span>
                          {cat.isInternal && (
                            <span className="text-[10px] text-gray-600 font-normal normal-case tracking-normal">
                              не реальные траты
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-gray-900 font-bold">
                            {formatEuro(cat.amount)}
                          </span>
                          <span className="text-gray-600 font-mono text-[11px] w-8 text-right">
                            {cat.percent}%
                          </span>
                        </div>
                      </div>
                      <div className="h-2 w-full bg-gray-50 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${cat.percent}%` }}
                          transition={{ duration: 1, ease: "easeOut" }}
                          className={cn("h-full rounded-full", cat.color)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
              <h2 className="text-lg font-extrabold text-gray-900 mb-6">
                Транзакции
              </h2>
              {transactions.length === 0 ? (
                <p className="text-[14px] text-[#9ca3af]">Транзакций не найдено.</p>
              ) : (
                <div className="overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                        <th className="pb-4">Дата</th>
                        <th className="pb-4">Контрагент</th>
                        <th className="pb-4 text-right">Сумма</th>
                        <th className="pb-4 pl-8">Категория</th>
                      </tr>
                    </thead>
                    <tbody className="text-[13px]">
                      {transactions.map((t, i) => {
                        const isIncome = !t.is_debit;
                        const signed = isIncome ? t.amount : -t.amount;
                        return (
                          <tr
                            key={t.id}
                            className={cn("group", i % 2 === 0 ? "bg-gray-50/30" : "bg-white")}
                          >
                            <td className="py-3 font-mono text-gray-600">
                              {formatTxDate(t.date)}
                            </td>
                            <td className="py-3 font-bold text-gray-900 max-w-[200px] truncate">
                              {t.description || "—"}
                            </td>
                            <td
                              className={cn(
                                "py-3 font-bold text-right",
                                isIncome ? "text-green-600" : "text-gray-900"
                              )}
                            >
                              {signed > 0 ? "+" : ""}
                              {formatEuro(Math.abs(signed))}
                            </td>
                            <td className="py-3 pl-8">
                              {/* Soft sentence-case pill — same vocabulary
                                  as the Overview footer pills. We drop
                                  the prior income/expense color split
                                  because the signed amount column already
                                  encodes that signal; the pill goes back
                                  to a single neutral gray so the eye
                                  reads the table by rows, not by stripes. */}
                              <span className="bg-gray-100 text-gray-600 rounded-full px-2 py-0.5 text-[11px] font-medium">
                                {formatCategoryLabel(t.category || "other")}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Right column opens with the unified AIR4 advisor card
              (shared shape with Sport, Projects, Goals, Health) and
              then drops into money-mechanics: «Предстоящие платежи»,
              «Подписки», «Кредиты». The advisor copy is derived from
              the same Finance state already in scope (income, spent,
              freeCapital, fixed costs) — no extra API call needed. */}
          <div className="col-span-2 space-y-6">
            <div className="relative overflow-hidden bg-[#4F46E5] rounded-2xl p-5 shadow-xl">
              <Wallet
                size={100}
                strokeWidth={1.5}
                className="absolute -top-3 -right-3 text-white/10 pointer-events-none"
              />
              <div className="relative space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    aria-hidden="true"
                    className="w-2 h-2 rounded-full bg-green-400 animate-pulse"
                  />
                  <span className="text-[11px] font-black text-white/80 uppercase tracking-widest">
                    AIR4 ADVISOR
                  </span>
                  <span className="bg-white/20 text-white text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full">
                    Финансы
                  </span>
                </div>
                {/* Tiered copy — pick the most actionable signal:
                    1. Negative free capital → spent > income, urgent
                    2. Fixed-cost burn ratio > 60% of income → squeeze
                    3. Healthy positive → keep momentum                 */}
                <p className="text-[14px] font-medium text-white leading-relaxed pr-12">
                  {income <= 0
                    ? `«Доход за цикл ещё не зафиксирован. Загрузите выписку, чтобы я мог посчитать свободный капитал.»`
                    : freeCapital < 0
                      ? `«Свободный капитал в минусе: потрачено ${formatEuro(spent)} при доходе ${formatEuro(income)}. Подрезайте переменные траты — фиксированные ${monthlyFixed ? formatEuro(monthlyFixed.fixed_total) : "—"}/мес уже залочены.»`
                      : monthlyFixed && monthlyFixed.fixed_total / income > 0.6
                        ? `«Постоянные расходы съедают ${Math.round((monthlyFixed.fixed_total / income) * 100)}% дохода (${formatEuro(monthlyFixed.fixed_total)} из ${formatEuro(income)}). Сократите хотя бы одну подписку или ускорьте погашение кредита.»`
                        : `«Свободный капитал за цикл — ${formatEuro(freeCapital)}. Резерв на ${monthlyFixed && monthlyFixed.fixed_total > 0 ? Math.floor(freeCapital / monthlyFixed.fixed_total) : "—"} мес постоянных расходов.»`}
                </p>
              </div>
            </div>

            <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
              <div className="flex items-baseline justify-between gap-3 mb-4">
                <h2 className="text-lg font-extrabold text-gray-900">
                  Предстоящие платежи
                </h2>
                {upcomingPayments.length > 0 && (
                  // Sum of the next-due amounts shown in the card body.
                  // No /мес suffix — these are discrete one-time future
                  // payments (next instalment per row), not recurring
                  // monthly totals. Hides automatically when every row
                  // has a null amount (sum === 0 in that edge case).
                  // `font-mono` keeps the figure aligned with the
                  // other header totals (Подписки, Кредиты) and the
                  // Monthly Snapshot hero numbers, so the eye reads
                  // every Finance total in the same monospaced rhythm.
                  <span className="font-mono text-lg font-extrabold text-[#6366F1] shrink-0">
                    {formatEuro(
                      upcomingPayments.reduce(
                        (sum, p) => sum + (p.amount ?? 0),
                        0,
                      ),
                    )}
                  </span>
                )}
              </div>
              {upcomingPayments.length === 0 ? (
                <ChatEmpty label="Запланированных платежей нет" />
              ) : (
                <ul className="divide-y divide-gray-50">
                  {upcomingPayments.map((p) => (
                    <li
                      key={p.key}
                      className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={cn(
                            "shrink-0 w-9 h-9 rounded-xl flex flex-col items-center justify-center text-[9px] font-bold uppercase tracking-wider",
                            p.kind === "subscription"
                              ? "bg-amber-50 text-amber-700"
                              : "bg-indigo-50 text-indigo-700"
                          )}
                        >
                          <span className="text-[10px] leading-none">
                            {p.date.toLocaleDateString("ru-RU", { month: "short" })}
                          </span>
                          <span className="font-mono text-[12px] leading-none mt-0.5">
                            {p.date.getDate()}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <p className="text-[13px] font-bold text-gray-900 truncate">
                            {p.name}
                          </p>
                          <p className="text-[10px] text-gray-600 font-mono mt-0.5">
                            {formatRelativeDate(p.date)}
                          </p>
                        </div>
                      </div>
                      <span className="text-[13px] font-bold text-gray-900 shrink-0">
                        {p.amount != null ? formatEuro(p.amount) : "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
              <div className="flex items-baseline justify-between gap-3 mb-4">
                <h2 className="text-lg font-extrabold text-gray-900">
                  Подписки · в месяц
                </h2>
                {subscriptions.length > 0 && monthlyFixed && (
                  // Same size + weight as the card title so the eye reads
                  // "Подписки · в месяц … 229.58 €/мес" as one balanced
                  // header line; indigo color anchors the sum visually.
                  // `font-mono` aligns the digits with the other Finance
                  // totals (Кредиты, Предстоящие платежи, Срез месяца).
                  <span className="font-mono text-lg font-extrabold text-[#6366F1] shrink-0">
                    {formatEuro(monthlyFixed.subscriptions_total)}/мес
                  </span>
                )}
              </div>
              {subscriptions.length === 0 ? (
                <ChatEmpty label="Подписки не отслеживаются" />
              ) : (
                <ul className="divide-y divide-gray-50">
                  {subscriptions.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-baseline justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <p className="text-[13px] font-bold text-gray-900 truncate">
                          {s.name}
                        </p>
                        {s.billing_day != null && (
                          <p className="text-[10px] text-gray-600 font-mono mt-0.5">
                            {s.billing_day}-е число
                          </p>
                        )}
                      </div>
                      <span className="text-[13px] font-bold text-gray-900 shrink-0">
                        {s.amount != null ? formatEuro(s.amount) : "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
              <div className="flex items-baseline justify-between gap-3 mb-4">
                <h2 className="text-lg font-extrabold text-gray-900">
                  Кредиты и обязательства
                </h2>
                {obligations.length > 0 && monthlyFixed && (
                  // `font-mono` matches the other Finance header totals
                  // so all monetary totals share the same monospaced
                  // baseline regardless of card.
                  <span className="font-mono text-lg font-extrabold text-[#6366F1] shrink-0">
                    {formatEuro(monthlyFixed.obligations_total)}/мес
                  </span>
                )}
              </div>
              {obligations.length === 0 ? (
                <ChatEmpty label="Кредитов нет" />
              ) : (
                // Each loan is now a self-contained mini-card on the
                // page's gray-50 surface so the rows read as standalone
                // units instead of a striped list. `space-y-3` gives a
                // 12px gap between cards (matches the spec's `mb-3` on
                // each card without piling margin + gap together).
                <ul className="space-y-3">
                  {obligations.map((o) => {
                    const total = o.total_amount;
                    const remaining = o.remaining_amount;
                    const hasProgress =
                      total != null &&
                      total > 0 &&
                      remaining != null &&
                      remaining >= 0;
                    const paid = hasProgress
                      ? Math.max(0, (total as number) - (remaining as number))
                      : 0;
                    const percentPaid = hasProgress
                      ? Math.min(100, Math.round((paid / (total as number)) * 100))
                      : 0;
                    const tone = progressTone(percentPaid);
                    // No-decimal Euro for the compact info line — keeps
                    // "3,654 € / 15,000 €" readable without cluttering
                    // with cents. Mirrors `formatEuro`'s "{amount} €"
                    // layout with a non-breaking space.
                    const fmtShort = (n: number) =>
                      `${n.toLocaleString("en-US", {
                        maximumFractionDigits: 0,
                      })}\u00A0€`;
                    // Final-payment year only ("2031-03-15" → "2031").
                    // Falls back to the raw string for non-ISO inputs.
                    const dueYear = o.due_date
                      ? o.due_date.slice(0, 4)
                      : null;
                    return (
                      <li
                        key={o.id}
                        className="bg-gray-50 rounded-xl border border-gray-100 p-4 space-y-2"
                      >
                        {/* Row 1 — name + monthly payment. Both dark
                            gray-900 so the row reads as one balanced
                            line; only the card-header total stays
                            indigo to anchor the section visually. */}
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="text-[13px] font-bold text-gray-900 truncate">
                            {o.name}
                          </p>
                          <span className="text-[13px] font-bold text-gray-900 shrink-0">
                            {o.monthly_payment != null
                              ? formatEuro(o.monthly_payment)
                              : "—"}
                          </span>
                        </div>
                        {hasProgress ? (
                          <>
                            {/* Row 2 — progress bar against gray-200
                                track (visible on the card's gray-50
                                surface). */}
                            <div className="h-2 w-full bg-gray-200 rounded-full overflow-hidden">
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${percentPaid}%` }}
                                transition={{ duration: 1, ease: "easeOut" }}
                                className={cn("h-full rounded-full", tone.bar)}
                              />
                            </div>
                            {/* Row 3 — ultra-compact single line. Drops
                                the "выплачено / осталось / срок"
                                labels in favour of pure numbers, and
                                pulls the % pill onto the same row so
                                the card terminates in one footer
                                rather than two. */}
                            <div className="flex items-center justify-between gap-3 text-[12px] text-gray-600">
                              <span className="truncate">
                                {fmtShort(paid)} / {fmtShort(total as number)}
                                {o.interest_rate != null &&
                                  ` · ${o.interest_rate.toFixed(1)}%`}
                                {dueYear && ` · до ${dueYear}`}
                              </span>
                              <span
                                className={cn(
                                  "shrink-0 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider",
                                  tone.badge
                                )}
                              >
                                {percentPaid}% выплачено
                              </span>
                            </div>
                          </>
                        ) : (
                          // No progress data — same compact one-liner
                          // with whatever fields exist; conditional
                          // bullets so we never render a leading or
                          // duplicate "·".
                          <div className="text-[12px] text-gray-600 truncate">
                            {remaining != null && fmtShort(remaining)}
                            {o.interest_rate != null && (
                              <>
                                {remaining != null && " · "}
                                {o.interest_rate.toFixed(1)}%
                              </>
                            )}
                            {dueYear && (
                              <>
                                {(remaining != null ||
                                  o.interest_rate != null) &&
                                  " · "}
                                до {dueYear}
                              </>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
        <h2 className="text-lg font-extrabold text-gray-900 mb-6">
          Выписки
        </h2>
        {loading && uploads.length === 0 ? (
          <p className="text-[14px] text-[#9ca3af]">Загрузка…</p>
        ) : uploads.length === 0 ? (
          <p className="text-[14px] text-[#9ca3af]">Выписки пока не загружены.</p>
        ) : (
          <ul className="divide-y divide-gray-50">
            {uploads.map((up) => (
              <li
                key={up.id}
                className="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-bold text-[#111827] truncate">{up.filename}</p>
                  <p className="text-[12px] text-[#6b7280] font-mono mt-1">
                    {formatPeriod(up.period_start, up.period_end)}
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] text-[#9ca3af] font-bold uppercase tracking-wider">
                    <span>{up.total_transactions} транзакций</span>
                    <span>Загружено {formatUploadDate(up.created_at)}</span>
                    {up.account_iban && (
                      <span className="font-mono normal-case tracking-normal">{up.account_iban}</span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleDeleteUpload(up.id)}
                  disabled={deletingId === up.id}
                  className="shrink-0 p-2.5 rounded-xl text-red-500 hover:bg-red-50 disabled:opacity-50 transition-colors"
                  aria-label={`Удалить ${up.filename}`}
                >
                  {deletingId === up.id ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <Trash2 size={18} />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <CategoryReview
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        cycleStart={cycleStart}
        cycleEnd={cycleEnd}
        onCategoryChanged={() => {
          // Refresh the cycle summary so the «Структура трат» chart
          // reflects the new categorization, and reload the «Транзакции»
          // preview so the badges match.
          if (cycleStart && cycleEnd) {
            void getSummary(cycleStart, cycleEnd)
              .then((data) => setSummary(data))
              .catch(() => {});
          }
          void getTransactions(10)
            .then((page) => setTransactions(page.items))
            .catch(() => {});
        }}
      />
    </div>
  );
}
