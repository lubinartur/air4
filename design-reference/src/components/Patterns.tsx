import { Brain, Repeat, Sparkles } from "lucide-react";
import type { Hypothesis } from "../lib/api";
import { cn } from "../lib/utils";
import { PageEmptyState } from "./PageEmptyState";

type Props = {
  hypotheses: Hypothesis[];
};

function statusBadge(status: string): { label: string; className: string } {
  const s = status.toLowerCase();
  if (s === "confirmed") {
    return { label: "CONFIRMED", className: "bg-green-50 text-green-600" };
  }
  if (s === "rejected") {
    return { label: "REJECTED", className: "bg-red-50 text-red-600" };
  }
  return { label: "PENDING", className: "bg-gray-100 text-gray-500" };
}

function ConfidenceIndicator({ confidence }: { confidence: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, confidence)) * 100);
  const filled = Math.max(0, Math.min(5, Math.round(confidence * 5)));

  return (
    <div className="flex items-center gap-2" title={`${pct}% confidence`}>
      <div className="flex gap-0.5">
        {Array.from({ length: 5 }, (_, i) => (
          <span
            key={i}
            className={cn(
              "w-1.5 h-1.5 rounded-full",
              i < filled ? "bg-indigo-500" : "bg-gray-200"
            )}
          />
        ))}
      </div>
      <span className="text-[11px] font-bold text-[#9ca3af] tabular-nums">{pct}%</span>
    </div>
  );
}

function domainLabel(domain: string): string {
  return domain.replace(/_/g, " ");
}

export function Patterns({ hypotheses }: Props) {
  const header = (
    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
      <div className="flex items-center gap-2.5">
        <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
          <Repeat size={22} className="fill-indigo-100" />
        </div>
        <div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight">
            Behavioral Patterns
          </h1>
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">
            Detected habits and confirmed hypotheses
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 bg-indigo-50/50 border border-indigo-100 px-3.5 py-1.5 rounded-xl">
        <Sparkles size={14} className="text-indigo-600" />
        <span className="text-xs font-bold text-indigo-700">Pattern Recognition</span>
      </div>
    </div>
  );

  if (hypotheses.length === 0) {
    return (
      <div className="flex flex-col gap-8 pb-10">
        {header}
        <PageEmptyState
          icon={Brain}
          title="No patterns yet"
          subtext="AIR4 learns from your activity over time."
        />
        <p className="text-[13px] text-center text-[#9ca3af] font-medium">
          AIR4 will detect behavioral patterns as you use it. Keep logging.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 pb-10">
      {header}

      <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
        <h2 className="text-[11px] font-bold text-[#9ca3af] uppercase tracking-[0.1em] mb-6">
          Detected patterns
        </h2>
        <ul className="space-y-4">
          {hypotheses.map((h) => {
            const badge = statusBadge(h.status);
            const count = h.evidence_count;
            const confirmations =
              count === 1 ? "1 confirmation" : `${count} confirmations`;

            return (
              <li
                key={h.id}
                className="p-4 rounded-2xl bg-gray-50/50 border border-gray-50"
              >
                <div className="flex justify-between items-start gap-4 mb-3">
                  <p className="text-[15px] font-bold text-gray-900 leading-snug flex-1 min-w-0">
                    {h.text}
                  </p>
                  <span
                    className={cn(
                      "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-tighter shrink-0",
                      badge.className
                    )}
                  >
                    {badge.label}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <ConfidenceIndicator confidence={h.confidence} />
                  <span className="text-[12px] text-[#9ca3af] font-medium">{confirmations}</span>
                </div>

                {h.domains.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {h.domains.map((domain) => (
                      <span
                        key={domain}
                        className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600"
                      >
                        {domainLabel(domain)}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
