"use client";

import { deleteCrossSphereInsight, type CrossSphereInsight } from "@/lib/api";

function sphereBadgeClass(s: string | null | undefined): string {
  switch (s) {
    case "finance":
      return "border-blue-500/30 bg-blue-500/10 text-blue-200";
    case "life":
      return "border-purple-500/30 bg-purple-500/10 text-purple-200";
    case "projects":
      return "border-orange-500/30 bg-orange-500/10 text-orange-200";
    case "health":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
    default:
      return "border-zinc-700 bg-zinc-800/50 text-zinc-200";
  }
}

function sphereLabel(s: string | null | undefined): string {
  switch (s) {
    case "finance":
      return "Финансы";
    case "life":
      return "Жизнь";
    case "projects":
      return "Проекты";
    case "health":
      return "Здоровье";
    default:
      return "Другое";
  }
}

function confidenceBadge(conf: string | null | undefined): { cls: string; label: string } {
  switch (conf) {
    case "high":
      return { cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200", label: "high" };
    case "medium":
      return { cls: "border-amber-500/30 bg-amber-500/10 text-amber-200", label: "medium" };
    case "low":
      return { cls: "border-zinc-700 bg-zinc-800/50 text-zinc-200", label: "low" };
    default:
      return { cls: "border-zinc-700 bg-zinc-800/50 text-zinc-200", label: "—" };
  }
}

export function CrossSphereCard({
  insight,
  onDeleted,
}: {
  insight: CrossSphereInsight;
  onDeleted?: (id: number) => void;
}) {
  const conf = confidenceBadge(insight.confidence);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${sphereBadgeClass(
              insight.sphere1
            )}`}
          >
            {sphereLabel(insight.sphere1)}
          </span>
          <span className="text-xs text-zinc-400">→</span>
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${sphereBadgeClass(
              insight.sphere2
            )}`}
          >
            {sphereLabel(insight.sphere2)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${conf.cls}`}
          >
            {conf.label}
          </span>
          <button
            type="button"
            onClick={async () => {
              const id = Number(insight.id);
              if (!Number.isFinite(id)) return;
              await deleteCrossSphereInsight(id);
              onDeleted?.(id);
            }}
            className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-200 hover:bg-red-500/20"
          >
            Удалить
          </button>
        </div>
      </div>

      <div className="mt-3 font-medium text-zinc-100">{insight.title}</div>
      <p className="mt-2 text-sm leading-6 text-zinc-400">{insight.description}</p>
    </div>
  );
}

