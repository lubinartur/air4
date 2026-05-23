import { Scale, Sparkles } from "lucide-react";
import type { Dilemma } from "../lib/api";
import { cn } from "../lib/utils";
import { t as ty } from "../lib/typography";
import { PageEmptyState } from "./PageEmptyState";

type Props = {
  dilemmas: Dilemma[];
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

function isFollowupPending(d: Dilemma): boolean {
  if (!d.followup_due) return false;
  const done = d.followup_done;
  return done === false || done === 0 || done === undefined || done === null;
}

function statusBadge(status: string): { label: string; className: string } {
  const s = status.toLowerCase();
  if (s === "open") {
    return { label: "ОТКРЫТО", className: "bg-blue-50 text-blue-600" };
  }
  if (s === "decided" || s === "closed") {
    return { label: "РЕШЕНО", className: "bg-green-50 text-green-600" };
  }
  if (s === "abandoned") {
    return { label: "ОТМЕНЕНО", className: "bg-gray-100 text-gray-500" };
  }
  return { label: s.toUpperCase(), className: "bg-gray-100 text-gray-500" };
}

export function Dilemmas({ dilemmas }: Props) {
  const header = (
    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
      <div className="flex items-center gap-2.5">
        <div className="p-2 bg-violet-50 text-violet-600 rounded-xl">
          <Scale size={22} className="fill-violet-100" />
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

      <div className="flex items-center gap-2 bg-violet-50/50 border border-violet-100 px-3.5 py-1.5 rounded-xl">
        <Sparkles size={14} className="text-violet-600" />
        <span className="text-xs font-bold text-violet-700">Советник по решениям</span>
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
        <p className="text-[13px] text-center text-[#9ca3af] font-medium">
          Обсудите трудное решение с AIR4 в чате — оно появится здесь.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 pb-10">
      {header}

      <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
        <h2 className="text-lg font-extrabold text-gray-900 mb-6">
          Ваши дилеммы
        </h2>
        <ul className="space-y-4">
          {dilemmas.map((d) => {
            const badge = statusBadge(d.status);
            return (
              <li
                key={d.id}
                className="p-4 rounded-2xl bg-gray-50/50 border border-gray-50"
              >
                <div className="flex justify-between items-start gap-4 mb-2">
                  <h3 className="text-[15px] font-bold text-gray-900 leading-snug">{d.title}</h3>
                  <span
                    className={cn(
                      "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-tighter shrink-0",
                      badge.className
                    )}
                  >
                    {badge.label}
                  </span>
                </div>
                {d.description && (
                  <p className="text-[14px] text-gray-600 leading-relaxed">
                    {truncate(d.description, 150)}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[#9ca3af]">
                  {d.created_at && (
                    <span>Создано {formatDate(d.created_at)}</span>
                  )}
                  {isFollowupPending(d) && (
                    <span className="font-medium text-amber-600">
                      Напомнить: {formatDate(d.followup_due)}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
