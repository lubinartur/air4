import { Target } from "lucide-react";
import type { GoalItem } from "../lib/api";
import { PageEmptyState } from "./PageEmptyState";

type Props = {
  goals: GoalItem[];
};

export function Goals({ goals }: Props) {
  const header = (
    <div>
      <h1 className="text-4xl font-black text-gray-900 tracking-tight">Goals</h1>
      <p className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.2em] mt-1">
        Life Advisor
      </p>
    </div>
  );

  if (goals.length === 0) {
    return (
      <div className="flex flex-col gap-8 pb-10">
        {header}
        <PageEmptyState
          icon={Target}
          title="No goals yet"
          subtext="Share your goals with AIR4 in chat."
        />
        <p className="text-[13px] text-center text-[#9ca3af] font-medium">
          Tell AIR4 about your goals in chat — they&apos;ll appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 pb-10">
      {header}

      <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
        <h2 className="text-[11px] font-bold text-[#9ca3af] uppercase tracking-[0.1em] mb-6">
          Your goals
        </h2>
        <ul className="space-y-4">
          {goals.map((goal) => (
            <li
              key={`${goal.source}-${goal.id}-${goal.key ?? ""}`}
              className="flex items-start gap-4 p-4 rounded-2xl bg-gray-50/50 border border-gray-50"
            >
              <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0 mt-0.5">
                <Target size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-bold text-gray-900 leading-snug">{goal.title}</p>
                {goal.source === "facts" && goal.key && (
                  <p className="text-[11px] text-[#9ca3af] font-mono mt-1 uppercase tracking-wide">
                    from {goal.key.replace(/_/g, " ")}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-[13px] text-center text-[#9ca3af] font-medium">
        Tell AIR4 about your goals in chat — they&apos;ll appear here.
      </p>
    </div>
  );
}
