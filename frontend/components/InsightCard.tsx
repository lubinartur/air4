"use client";

import type { Insight } from "@/lib/api";
import { categoryLabel, textWithCategoryLabels } from "@/lib/categories";

export function InsightCard({ insight }: { insight: Insight }) {
  return (
    <div className="rounded-2xl border border-zinc-100 bg-white p-5 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wider text-zinc-400">
        {categoryLabel(insight.type)}
      </div>
      <div className="mt-1 text-base font-semibold text-zinc-900">
        {textWithCategoryLabels(insight.title)}
      </div>
      <div className="mt-2 text-sm leading-6 text-zinc-700">
        {textWithCategoryLabels(insight.description)}
      </div>
      {typeof insight.amount_mentioned === "number" ? (
        <div className="mt-3 text-sm font-medium text-zinc-900">
          Mentioned: €{insight.amount_mentioned.toFixed(2)}
        </div>
      ) : null}
    </div>
  );
}

