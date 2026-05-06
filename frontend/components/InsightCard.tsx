"use client";

import type { Insight } from "@/lib/api";
import { categoryLabel, textWithCategoryLabels } from "@/lib/categories";

export function InsightCard({ insight }: { insight: Insight }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-zinc-900/40 p-5 shadow-sm backdrop-blur-xl">
      <div className="text-xs font-medium uppercase tracking-wider text-zinc-500">
        {categoryLabel(insight.type)}
      </div>
      <div className="mt-1 text-base font-semibold text-zinc-100">
        {textWithCategoryLabels(insight.title)}
      </div>
      <div className="mt-2 text-sm leading-6 text-zinc-400">
        {textWithCategoryLabels(insight.description)}
      </div>
      {typeof insight.amount_mentioned === "number" ? (
        <div className="mt-3 text-sm font-medium text-zinc-100">
          Упомянуто: €{insight.amount_mentioned.toFixed(2)}
        </div>
      ) : null}
    </div>
  );
}

