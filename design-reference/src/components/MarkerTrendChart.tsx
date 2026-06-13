import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { HealthMarkerHistory } from "../lib/api";
import { cn } from "../lib/utils";

interface MarkerTrendChartProps {
  history: HealthMarkerHistory;
  /** Fixed compact height per spec. Overridable for the (unlikely)
   *  case the chart is embedded in a wider report later. */
  height?: number;
}

type DotPayload = {
  cx?: number;
  cy?: number;
  index?: number;
  payload?: {
    value: number;
    status: string;
    isLast: boolean;
    refMin: number | null;
    refMax: number | null;
  };
};

function formatShortDate(iso: string): string {
  // Show the year (the only thing that changes meaningfully across
  // multi-year checkup spans) plus the month, e.g. "Mar '26".
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const month = d.toLocaleDateString("en-US", { month: "short" });
  const year = String(d.getFullYear()).slice(-2);
  return `${month} '${year}`;
}

function pointColor(status: string): string {
  const s = status.toUpperCase();
  if (s === "HIGH" || s === "LOW") return "#ef4444"; // red-500
  return "#22c55e"; // green-500
}

/** Renders a compact trend of one biomarker across all checkups.
 *
 *  Reference band is drawn as a translucent green ReferenceArea, the
 *  current value (last point) is rendered with a larger emphasised
 *  dot, and every dot is recolored red when its status is HIGH/LOW.
 *  Y domain is computed to comfortably include both the data extremes
 *  and the reference band — without this, a tightly-fit auto domain
 *  would clip the reference band against the top/bottom edges. */
export function MarkerTrendChart({
  history,
  height = 160,
}: MarkerTrendChartProps) {
  const { chartData, yDomain, refMin, refMax, unit } = useMemo(() => {
    const pts = history.points;
    const refMin =
      pts.find((p) => p.reference_min != null)?.reference_min ?? null;
    const refMax =
      pts.find((p) => p.reference_max != null)?.reference_max ?? null;
    const unit = pts.find((p) => p.unit)?.unit ?? "";

    const lastIdx = pts.length - 1;
    const chartData = pts.map((p, i) => ({
      date: p.date,
      label: formatShortDate(p.date),
      value: p.value,
      status: p.status,
      isLast: i === lastIdx,
      refMin,
      refMax,
    }));

    const values = pts.map((p) => p.value);
    const candidates: number[] = [...values];
    if (refMin != null) candidates.push(refMin);
    if (refMax != null) candidates.push(refMax);
    const min = candidates.length ? Math.min(...candidates) : 0;
    const max = candidates.length ? Math.max(...candidates) : 1;
    const pad = max === min ? Math.abs(max) * 0.1 || 1 : (max - min) * 0.12;
    const yDomain: [number, number] = [
      Math.max(0, min - pad),
      max + pad,
    ];

    return { chartData, yDomain, refMin, refMax, unit };
  }, [history]);

  if (chartData.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-[11px] text-[#94a3b8] italic"
        style={{ height }}
      >
        Нет исторических данных для этого маркера.
      </div>
    );
  }

  // Single data point — recharts will render a vertical line at zero
  // width, which looks like a glitch. Show the lone value as a chip
  // with a hint that more history will arrive on the next checkup.
  if (chartData.length === 1) {
    const only = chartData[0];
    return (
      <div
        className="flex flex-col items-center justify-center gap-2"
        style={{ height }}
      >
        <div className="flex items-baseline gap-1.5">
          <span className="font-mono text-2xl font-bold text-[#f1f5f9]">
            {only.value}
          </span>
          {unit && (
            <span className="text-[10px] text-[#94a3b8] font-medium">
              {unit}
            </span>
          )}
        </div>
        <p className="text-[10px] text-[#94a3b8] uppercase tracking-wider">
          {only.label} · единственная точка
        </p>
      </div>
    );
  }

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={chartData}
          margin={{ top: 8, right: 12, bottom: 4, left: 0 }}
        >
          <CartesianGrid
            stroke="rgba(255,255,255,0.06)"
            strokeDasharray="3 3"
            vertical={false}
          />
          {refMin != null && refMax != null && (
            <ReferenceArea
              y1={refMin}
              y2={refMax}
              fill="#22c55e"
              fillOpacity={0.08}
              stroke="#22c55e"
              strokeOpacity={0.15}
              strokeDasharray="2 2"
            />
          )}
          {refMin != null && (
            <ReferenceLine
              y={refMin}
              stroke="#22c55e"
              strokeOpacity={0.35}
              strokeDasharray="2 2"
            />
          )}
          {refMax != null && (
            <ReferenceLine
              y={refMax}
              stroke="#22c55e"
              strokeOpacity={0.35}
              strokeDasharray="2 2"
            />
          )}
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: "#94a3b8" }}
            tickLine={false}
            axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
          />
          <YAxis
            domain={yDomain}
            width={36}
            tick={{ fontSize: 10, fill: "#94a3b8" }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            cursor={{
              stroke: "rgba(249,115,22,0.4)",
              strokeWidth: 1,
              strokeDasharray: "3 3",
            }}
            contentStyle={{
              fontSize: 11,
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.1)",
              backgroundColor: "#13131f",
              color: "#f1f5f9",
              padding: "6px 10px",
            }}
            labelFormatter={(label) => String(label)}
            formatter={(value: number) => [
              `${value}${unit ? ` ${unit}` : ""}`,
              "Значение",
            ]}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke="#f97316"
            strokeWidth={2}
            isAnimationActive={false}
            dot={(props: DotPayload) => {
              const { cx, cy, payload, index } = props;
              if (cx == null || cy == null || !payload) {
                return <g key={`empty-${index ?? 0}`} />;
              }
              const fill = pointColor(payload.status);
              const r = payload.isLast ? 5 : 3.5;
              return (
                <g key={`dot-${index ?? payload.value}`}>
                  {payload.isLast && (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={r + 3}
                      fill={fill}
                      fillOpacity={0.18}
                    />
                  )}
                  <circle
                    cx={cx}
                    cy={cy}
                    r={r}
                    fill={fill}
                    stroke="#ffffff"
                    strokeWidth={1.5}
                  />
                </g>
              );
            }}
            activeDot={{
              r: 6,
              fill: "#f97316",
              stroke: "#ffffff",
              strokeWidth: 2,
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Tiny legend rendered under the chart. Kept as a separate export
 *  so the parent can stitch it into the detail panel header without
 *  the chart owning its own surrounding chrome. */
export function MarkerTrendLegend({
  refMin,
  refMax,
  unit,
  className,
}: {
  refMin: number | null;
  refMax: number | null;
  unit: string | null;
  className?: string;
}) {
  if (refMin == null && refMax == null) return null;
  const rangeText =
    refMin != null && refMax != null
      ? `${refMin}–${refMax}${unit ? ` ${unit}` : ""}`
      : refMin != null
        ? `> ${refMin}${unit ? ` ${unit}` : ""}`
        : `< ${refMax}${unit ? ` ${unit}` : ""}`;
  return (
    <div
      className={cn(
        "flex items-center gap-3 text-[10px] text-[#94a3b8]",
        className
      )}
    >
      <span className="inline-flex items-center gap-1.5">
        <span className="w-3 h-2 rounded-sm bg-green-100 border border-green-300/60" />
        Референс {rangeText}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-green-500" />
        В норме
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-red-500" />
        Вне нормы
      </span>
    </div>
  );
}
