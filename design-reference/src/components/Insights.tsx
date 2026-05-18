import { Page, Insight } from "../types";
import { cn } from "../lib/utils";

interface InsightsProps {
  currentPage: Page;
  insights: Insight[];
}

export function Insights({ currentPage, insights }: InsightsProps) {
  const filteredInsights = insights.filter(i => i.category === currentPage || i.category === "All");

  if (filteredInsights.length === 0) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {filteredInsights.map((insight) => (
        <div 
          key={insight.id} 
          className="bg-surface rounded-xl p-6 border border-gray-100 hover:border-gray-200 transition-colors"
        >
          <div className="flex items-center gap-2 mb-4">
            <div 
              className={cn(
                "w-2 h-2 rounded-full",
                insight.status === "critical" ? "bg-red-500" : 
                insight.status === "warning" ? "bg-amber-500" : "bg-green-500"
              )} 
            />
            <span className="text-[10px] font-mono uppercase tracking-widest text-gray-400">
              {insight.category}
            </span>
          </div>
          <p className="text-sm leading-relaxed text-gray-800 font-medium">
            {insight.content}
          </p>
        </div>
      ))}
    </div>
  );
}
