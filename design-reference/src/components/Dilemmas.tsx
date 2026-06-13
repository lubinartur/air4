import { useMemo, useState } from "react";
import { CheckCircle2, Clock, Scale, Sparkles } from "lucide-react";
import { submitFollowupAnswer, type Dilemma } from "../lib/api";
import { cn } from "../lib/utils";
import { t as ty } from "../lib/typography";
import { PageEmptyState } from "./PageEmptyState";

type Props = {
  dilemmas: Dilemma[];
  onRefresh?: () => void | Promise<void>;
};

function truncate(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max).trimEnd()}…`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso.includes("T") ? iso : `${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// Domain → Russian label + accent palette (kept in sync with the
// Patterns page). Tags that aren't known domains fall back to the
// orange accent with their raw label uppercased.
const DOMAIN_BADGE: Record<string, { label: string; className: string }> = {
  finance: {
    label: "ФИНАНСЫ",
    className: "bg-[#3b82f6]/15 text-[#3b82f6] border-[#3b82f6]/30",
  },
  health: {
    label: "ЗДОРОВЬЕ",
    className: "bg-[#22c55e]/15 text-[#22c55e] border-[#22c55e]/30",
  },
  projects: {
    label: "ПРОЕКТЫ",
    className: "bg-[#a855f7]/15 text-[#a855f7] border-[#a855f7]/30",
  },
  life: {
    label: "ЖИЗНЬ",
    className: "bg-[#f97316]/15 text-[#f97316] border-[#f97316]/30",
  },
  personal: {
    label: "ЛИЧНОЕ",
    className: "bg-[#ec4899]/15 text-[#ec4899] border-[#ec4899]/30",
  },
};

function domainBadge(tag: string): { label: string; className: string } {
  return (
    DOMAIN_BADGE[(tag || "").toLowerCase()] ?? {
      label: tag.toUpperCase(),
      className: "bg-[#f97316]/15 text-[#f97316] border-[#f97316]/30",
    }
  );
}

function isFollowupPending(d: Dilemma): boolean {
  if (!d.followup_due) return false;
  const done = d.followup_done;
  return done === false || done === 0 || done === undefined || done === null;
}

function isFollowupDue(d: Dilemma): boolean {
  if (!isFollowupPending(d)) return false;
  const todayIso = new Date().toISOString().slice(0, 10);
  return String(d.followup_due).slice(0, 10) <= todayIso;
}

function statusBadge(status: string): { label: string; className: string } {
  const s = status.toLowerCase();
  if (s === "open") {
    return {
      label: "ОТКРЫТО",
      className: "bg-[#3b82f6]/15 text-[#3b82f6] border border-[#3b82f6]/30",
    };
  }
  if (s === "decided" || s === "closed") {
    return {
      label: "РЕШЕНО",
      className: "bg-[#22c55e]/15 text-[#22c55e] border border-[#22c55e]/30",
    };
  }
  if (s === "abandoned") {
    return {
      label: "ЗАБРОШЕНО",
      className: "bg-[#6b7280]/15 text-[#6b7280] border border-[#6b7280]/30",
    };
  }
  return {
    label: s.toUpperCase(),
    className: "bg-[#6b7280]/15 text-[#6b7280] border border-[#6b7280]/30",
  };
}

// Inline follow-up answer form — rendered above each due dilemma so
// the user can close the loop without leaving the page. Submission
// calls /dilemmas/{id}/followup-answer which sets `followup_done`,
// `followup_answer`, and (if outcome was empty) mirrors the answer
// into `outcome` server-side. After save we trigger the parent's
// refresh callback so the row updates in place.
function FollowupForm({
  dilemma,
  onSaved,
}: {
  dilemma: Dilemma;
  onSaved?: () => void | Promise<void>;
}) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const answer = text.trim();
    if (!answer || saving) return;
    setSaving(true);
    setError(null);
    try {
      await submitFollowupAnswer(dilemma.id, answer);
      setText("");
      await onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 flex flex-col gap-2 p-3 rounded-xl bg-[#1e1e2e] border border-white/10"
    >
      <p className="text-[13px] text-[#f1f5f9] font-medium leading-snug">
        Прошло время — как вышло с этим решением?
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Что в итоге произошло?"
        rows={2}
        disabled={saving}
        className="w-full px-3 py-2 text-[14px] text-[#f1f5f9] bg-[#1e1e2e] border border-white/10 rounded-lg resize-none focus:outline-none focus:border-[#f97316] focus:ring-2 focus:ring-[#f97316]/20 disabled:opacity-60"
      />
      <div className="flex items-center justify-between gap-3">
        {error ? (
          <span className="text-[12px] text-red-500 font-medium">{error}</span>
        ) : (
          <span className="text-[12px] text-[#94a3b8]">
            Ответ сохранится в исход решения
          </span>
        )}
        <button
          type="submit"
          disabled={saving || !text.trim()}
          className="px-3 py-1.5 text-[13px] font-bold text-white bg-[#f97316] rounded-lg hover:bg-[#ea6a06] disabled:bg-[#f97316]/40 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? "Сохраняем…" : "Записать исход"}
        </button>
      </div>
    </form>
  );
}

export function Dilemmas({ dilemmas, onRefresh }: Props) {
  // Split into two visual buckets so due follow-ups float to the top
  // — the rest of the list keeps its existing reverse-chronological
  // ordering from the API.
  const { dueFollowups, restList } = useMemo(() => {
    const dueIds = new Set<number>();
    const due: Dilemma[] = [];
    for (const d of dilemmas) {
      if (isFollowupDue(d)) {
        due.push(d);
        dueIds.add(d.id);
      }
    }
    return {
      dueFollowups: due,
      restList: dilemmas.filter((d) => !dueIds.has(d.id)),
    };
  }, [dilemmas]);

  const header = (
    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 animate-fade-in-up animate-delay-1">
      <div className="flex items-center gap-2.5">
        <div className="p-2 bg-[#f97316]/15 text-[#f97316] rounded-xl">
          <Scale size={22} className="fill-[#f97316]/20" />
        </div>
        <div>
          <h1 className={ty.pageTitle}>
            Центр решений
          </h1>
          <p className={cn(ty.pageSub, "mt-0.5")}>
            Активные дилеммы и история решений
          </p>
        </div>
      </div>

    </div>
  );

  if (dilemmas.length === 0) {
    return (
      <div className="flex flex-col gap-8 pb-10">
        {header}
        <PageEmptyState
          icon={Scale}
          title="Дилемм пока нет"
          subtext="Стоите перед сложным решением? Опишите его AIR4 в чате."
        />
        <p className="text-[13px] text-center text-[#94a3b8] font-medium">
          Обсудите трудное решение с AIR4 в чате — оно появится здесь.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 pb-10">
      {header}

      {dueFollowups.length > 0 && (
        <div className="bg-[#13131f] rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)] card-hover animate-fade-in-up animate-delay-2">
          <h2 className="text-lg font-extrabold text-[#f1f5f9] mb-1">
            Ждут вашего ответа
          </h2>
          <p className="text-[13px] text-[#94a3b8] mb-5">
            Решения, по которым подошёл срок подвести итог
          </p>
          <ul className="space-y-4">
            {dueFollowups.map((d) => (
              <li
                key={d.id}
                className="p-4 rounded-2xl bg-[#1e1e2e] border border-white/5 card-hover"
              >
                <DilemmaRowContent dilemma={d} />
                <FollowupForm dilemma={d} onSaved={onRefresh} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-[#13131f] rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)] card-hover animate-fade-in-up animate-delay-3">
        <h2 className="text-lg font-extrabold text-[#f1f5f9] mb-6">
          Ваши дилеммы
        </h2>
        {restList.length === 0 ? (
          <p className="text-[13px] text-[#94a3b8]">
            Все дилеммы перечислены выше.
          </p>
        ) : (
          <ul className="space-y-4">
            {restList.map((d) => (
              <li
                key={d.id}
                className="p-4 rounded-2xl bg-[#1e1e2e] border border-white/5 card-hover"
              >
                <DilemmaRowContent dilemma={d} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// Shared row body: title + badge, description, decision/outcome blocks,
// and the created → decided → followed-up timeline. Extracted into its
// own component because both the "due follow-ups" and "all dilemmas"
// lists render exactly the same content — only the surrounding shell
// (form, background tint) differs.
function DilemmaRowContent({ dilemma: d }: { dilemma: Dilemma }) {
  const badge = statusBadge(d.status);
  const tags = Array.isArray(d.tags) ? d.tags : [];
  return (
    <>
      <div className="flex justify-between items-start gap-4 mb-2">
        <h3 className="text-[15px] font-bold text-[#f1f5f9] leading-snug">
          {d.title}
        </h3>
        <span
          className={cn(
            "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-tighter shrink-0",
            badge.className,
          )}
        >
          {badge.label}
        </span>
      </div>

      {d.description && (
        <p className="text-[14px] text-[#cbd5e1] leading-relaxed">
          {truncate(d.description, 150)}
        </p>
      )}

      {d.decision_made && (
        <div className="mt-3 p-2.5 rounded-lg bg-[#1e1e2e] border-l-[3px] border-l-[#f97316]">
          <p className="text-[11px] font-bold text-[#f97316] uppercase tracking-tight mb-0.5">
            Решение
          </p>
          <p className="text-[13.5px] text-[#f1f5f9] leading-snug">
            {d.decision_made}
          </p>
        </div>
      )}

      {d.outcome && (
        <div className="mt-2 p-2.5 rounded-lg bg-[#f97316]/15 border border-[#f97316]/30">
          <p className="text-[11px] font-bold text-[#f97316] uppercase tracking-tight mb-0.5">
            Исход
          </p>
          <p className="text-[13.5px] text-[#f1f5f9] leading-snug">
            {d.outcome}
          </p>
        </div>
      )}

      {tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {tags.map((tag) => {
            const b = domainBadge(tag);
            return (
              <span
                key={tag}
                className={cn(
                  "text-[10px] font-bold uppercase tracking-tight px-2 py-0.5 rounded-md border",
                  b.className
                )}
              >
                {b.label}
              </span>
            );
          })}
        </div>
      )}

      <DilemmaTimeline dilemma={d} />
    </>
  );
}

// Three-stop horizontal timeline: Создано → Решено → Подведён итог.
// Stops light up as their corresponding state is reached so the user
// can see at a glance where each dilemma sits in the decision loop.
function DilemmaTimeline({ dilemma: d }: { dilemma: Dilemma }) {
  const isDecided =
    d.status.toLowerCase() === "decided" ||
    d.status.toLowerCase() === "closed" ||
    !!d.decision_made;
  const isFollowedUp =
    d.followup_done === true || d.followup_done === 1 || !!d.outcome;

  const followupLabel = isFollowedUp
    ? "Подведён итог"
    : isFollowupPending(d) && d.followup_due
      ? `Напомнить: ${formatDate(d.followup_due)}`
      : "Итог ещё не подведён";

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[#94a3b8]">
      <TimelineStop
        active
        icon={<Clock size={11} />}
        label={d.created_at ? `Создано ${formatDate(d.created_at)}` : "Создано"}
      />
      <span className="text-[#64748b]">→</span>
      <TimelineStop
        active={isDecided}
        icon={<CheckCircle2 size={11} />}
        label="Решено"
      />
      <span className="text-[#64748b]">→</span>
      <TimelineStop
        active={isFollowedUp}
        icon={<Sparkles size={11} />}
        label={followupLabel}
        emphasize={!isFollowedUp && isFollowupPending(d)}
      />
    </div>
  );
}

function TimelineStop({
  active,
  icon,
  label,
  emphasize,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  emphasize?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1",
        emphasize
          ? "text-amber-600 font-medium"
          : active
            ? "text-[#cbd5e1] font-medium"
            : "text-[#64748b]",
      )}
    >
      {icon}
      {label}
    </span>
  );
}
