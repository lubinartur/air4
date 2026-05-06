"use client";

import {
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  Cell,
  Legend,
} from "recharts";
import { categoryLabel } from "@/lib/categories";

const COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#a78bfa",
  "#22d3ee",
  "#0ea5e9",
  "#27272a",
  "#52525b",
  "#71717a",
];

export function SpendingChart({
  data,
}: {
  data: { category: string; amount: number }[];
}) {
  const chartData = data
    .filter((d) => d.amount > 0)
    .map((d) => ({
      name: categoryLabel(d.category),
      categoryKey: d.category,
      value: d.amount,
    }));

  if (chartData.length === 0) {
    return (
      <div className="rounded-2xl border border-white/5 bg-zinc-900/40 p-6 shadow-sm backdrop-blur-xl">
        <div className="text-sm text-zinc-400">Данных о тратах пока нет.</div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/5 bg-zinc-900/40 p-6 shadow-sm backdrop-blur-xl">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Траты по категориям
        </h3>
        <span className="text-xs text-zinc-600">
          Без учёта доходов и внутренних переводов
        </span>
      </div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              outerRadius={100}
              innerRadius={55}
            >
              {chartData.map((d, idx) => (
                <Cell
                  key={d.categoryKey}
                  fill={COLORS[idx % COLORS.length]}
                />
              ))}
            </Pie>
            <Tooltip
              formatter={(value) => `€${Number(value ?? 0).toFixed(2)}`}
              contentStyle={{
                backgroundColor: "#09090b",
                color: "#e4e4e7",
                border: "1px solid #ffffff10",
                borderRadius: 8,
              }}
              labelStyle={{ color: "#a1a1aa", fontWeight: 600 }}
            />
            <Legend
              wrapperStyle={{ color: "#a1a1aa", fontSize: 12 }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

