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
  "#18181b",
  "#3f3f46",
  "#52525b",
  "#71717a",
  "#a1a1aa",
  "#d4d4d8",
  "#0ea5e9",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
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
      <div className="rounded-2xl border border-zinc-100 bg-white p-6 shadow-sm">
        <div className="text-sm text-zinc-700">No spending data yet.</div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-zinc-100 bg-white p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Spending by category
        </h3>
        <span className="text-xs text-zinc-400">
          Excludes income & internal transfers
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
                color: "#18181b",
                border: "1px solid #e4e4e7",
                borderRadius: 8,
              }}
              labelStyle={{ color: "#3f3f46", fontWeight: 600 }}
            />
            <Legend
              wrapperStyle={{ color: "#3f3f46", fontSize: 12 }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

