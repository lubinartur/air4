"use client";

import { deleteCrossSphereInsight, type CrossSphereInsight } from "@/lib/api";

function sphereBadgeClass(s: string | null | undefined): string {
  switch (s) {
    case "finance":
      return "border-blue-200 bg-blue-50 text-blue-800";
    case "life":
      return "border-purple-200 bg-purple-50 text-purple-800";
    case "projects":
      return "border-orange-200 bg-orange-50 text-orange-800";
    case "health":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    default:
      return "border-zinc-200 bg-zinc-50 text-zinc-700";
  }
}

function sphereLabel(s: string | null | undefined): string {
  switch (s) {
    case "finance":
      return "Finance";
    case "life":
      return "Life";
    case "projects":
      return "Projects";
    case "health":
      return "Health";
    default:
      return "Other";
  }
}

function confidenceBadge(conf: string | null | undefined): { cls: string; label: string } {
  switch (conf) {
    case "high":
      return { cls: "border-emerald-200 bg-emerald-50 text-emerald-800", label: "high" };
    case "medium":
      return { cls: "border-amber-200 bg-amber-50 text-amber-800", label: "medium" };
    case "low":
      return { cls: "border-zinc-200 bg-zinc-50 text-zinc-600", label: "low" };
    default:
      return { cls: "border-zinc-200 bg-zinc-50 text-zinc-600", label: "—" };
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
    <div className="rounded-2xl border border-zinc-100 bg-white p-5 shadow-sm">
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
              await deleteCrossSphereInsight(insight.id);
              onDeleted?.(insight.id);
            }}
            className="rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="mt-3 font-medium text-zinc-900">{insight.title}</div>
      <p className="mt-2 text-sm leading-6 text-zinc-500">{insight.description}</p>
    </div>
  );
}

