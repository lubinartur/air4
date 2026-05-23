import { useEffect, useRef, useState } from "react";
import { Check, Link2, Plus, Target } from "lucide-react";
import { cn } from "../lib/utils";
import type { GoalItem, ResolvedGoal } from "../lib/api";

interface ProjectGoalLinksProps {
  goals: ResolvedGoal[];
  goalKeys: string[];
  /** Full goals catalog from `/api/goals` — used to populate the
   *  connect dropdown. Pass an empty array to hide the picker (e.g.
   *  while the catalog is still loading). */
  catalog: GoalItem[];
  /** Click handler for an attached pill. Receives the goal `key` so
   *  the parent can either navigate to /goals or open a filter. */
  onGoalClick?: (key: string) => void;
  /** Replace the full set of linked goal keys. The parent owns the
   *  PUT call so it can optimistically update UI state. */
  onUpdate?: (nextKeys: string[]) => Promise<void> | void;
  /** Layout density — `compact` is for list rows (smaller pills, no
   *  picker by default), `expanded` is for the detail panel (taller
   *  pills + connect dropdown). */
  variant?: "compact" | "expanded";
  /** Disable the picker explicitly even in `expanded` variant —
   *  e.g. when the connect dropdown should be hidden in read-only
   *  contexts like the Overview dashboard. */
  showPicker?: boolean;
  className?: string;
}

/** Strip the catalog down to goals that aren't already linked. */
function unlinkedCatalog(
  catalog: GoalItem[],
  linkedKeys: Set<string>
): GoalItem[] {
  return catalog.filter((g) => {
    const key = g.key ?? "";
    return key.length > 0 && !linkedKeys.has(key);
  });
}

export function ProjectGoalLinks({
  goals,
  goalKeys,
  catalog,
  onGoalClick,
  onUpdate,
  variant = "expanded",
  showPicker,
  className,
}: ProjectGoalLinksProps) {
  const [open, setOpen] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close the dropdown on outside click / Escape so it behaves like
  // a popover instead of a sticky overlay.
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (e.target instanceof Node && wrapperRef.current.contains(e.target)) {
        return;
      }
      setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const linkedKeys = new Set(goalKeys);
  const picker = variant === "expanded" && showPicker !== false;
  const available = picker ? unlinkedCatalog(catalog, linkedKeys) : [];

  const handleLink = async (goalKey: string) => {
    if (!onUpdate || busyKey) return;
    setBusyKey(goalKey);
    try {
      await onUpdate([...goalKeys, goalKey]);
      setOpen(false);
    } finally {
      setBusyKey(null);
    }
  };

  const handleUnlink = async (
    e: React.MouseEvent<HTMLElement>,
    goalKey: string
  ) => {
    e.stopPropagation();
    if (!onUpdate || busyKey) return;
    setBusyKey(goalKey);
    try {
      await onUpdate(goalKeys.filter((k) => k !== goalKey));
    } finally {
      setBusyKey(null);
    }
  };

  if (goals.length === 0 && !picker) {
    return null;
  }

  const pillBase =
    variant === "compact"
      ? "inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full"
      : "inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full transition-colors";

  return (
    <div
      ref={wrapperRef}
      className={cn(
        "flex flex-wrap items-center gap-1.5 relative",
        className
      )}
    >
      {goals.map((goal) => {
        const orphan = !goal.title;
        const display = goal.title
          ? variant === "compact"
            ? truncate(goal.title, 28)
            : truncate(goal.title, 48)
          : `[${goal.key}]`;
        return (
          <button
            key={goal.key}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (onGoalClick) onGoalClick(goal.key);
            }}
            title={
              goal.title ??
              `Цель «${goal.key}» больше не существует — отвяжите её.`
            }
            className={cn(
              pillBase,
              orphan
                ? "bg-gray-50 border border-gray-200 text-gray-400 italic"
                : variant === "compact"
                  ? "bg-indigo-50 border border-indigo-100 text-indigo-600 hover:bg-indigo-100"
                  : "bg-indigo-50 border border-indigo-100 text-indigo-700 hover:bg-indigo-100 hover:border-indigo-200"
            )}
          >
            <Target
              size={variant === "compact" ? 10 : 12}
              className={cn(
                orphan ? "text-gray-300" : "text-indigo-500"
              )}
            />
            {variant === "expanded" && !orphan && (
              <span className="text-[9px] font-black uppercase tracking-wider text-indigo-400 mr-0.5">
                Цель
              </span>
            )}
            <span className="truncate max-w-[180px]">{display}</span>
            {onUpdate && variant === "expanded" && (
              <span
                role="button"
                tabIndex={-1}
                aria-label={`Отвязать «${display}»`}
                onClick={(e) => void handleUnlink(e, goal.key)}
                className={cn(
                  "ml-0.5 inline-flex items-center justify-center w-4 h-4 rounded-full",
                  "text-indigo-400 hover:text-indigo-700 hover:bg-indigo-100",
                  busyKey === goal.key && "opacity-50"
                )}
              >
                ×
              </span>
            )}
          </button>
        );
      })}

      {picker && onUpdate && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen((v) => !v);
            }}
            disabled={catalog.length === 0}
            className={cn(
              "inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full transition-colors",
              "border border-dashed border-indigo-200 text-indigo-500 hover:bg-indigo-50 hover:border-indigo-300",
              "disabled:opacity-40 disabled:cursor-not-allowed"
            )}
            title={
              catalog.length === 0
                ? "Целей пока нет — расскажите AIR4 в чате."
                : "Связать с целью"
            }
          >
            <Plus size={11} />
            Связать с целью
          </button>

          {open && (
            <div
              className={cn(
                "absolute top-full left-0 mt-2 z-20",
                "w-[280px] max-h-[260px] overflow-y-auto",
                "bg-white border border-gray-100 rounded-xl shadow-lg",
                "p-1.5"
              )}
            >
              {available.length === 0 ? (
                <p className="px-3 py-2 text-[11px] text-gray-400 italic">
                  Все доступные цели уже связаны.
                </p>
              ) : (
                available.map((goal) => {
                  const key = goal.key ?? "";
                  return (
                    <button
                      key={`${goal.source}-${goal.id}-${key}`}
                      type="button"
                      onClick={() => void handleLink(key)}
                      disabled={busyKey === key}
                      className={cn(
                        "w-full text-left px-3 py-2 rounded-lg",
                        "flex items-start gap-2 text-[12px]",
                        "hover:bg-indigo-50 transition-colors",
                        "disabled:opacity-50"
                      )}
                    >
                      <Link2
                        size={12}
                        className="text-indigo-400 mt-0.5 shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-800 leading-snug line-clamp-2">
                          {goal.title}
                        </p>
                        <p className="text-[10px] text-gray-400 uppercase tracking-wider mt-0.5">
                          {goal.source === "profile" ? "из профиля" : key}
                        </p>
                      </div>
                      {busyKey === key && (
                        <Check size={12} className="text-indigo-400 mt-0.5" />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function truncate(text: string, max: number): string {
  const clean = text.trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max).trimEnd() + "…";
}
