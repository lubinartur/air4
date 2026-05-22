import { NAVIGATION, PAGE_LABELS } from "../constants";
import { Page } from "../types";
import { cn } from "../lib/utils";

interface SidebarProps {
  currentPage: Page;
  onPageChange: (page: Page) => void;
  isCollapsed?: boolean;
}

export function Sidebar({ currentPage, onPageChange, isCollapsed }: SidebarProps) {
  const topNav = NAVIGATION.slice(0, -1);
  const bottomNav = NAVIGATION.slice(-1);

  return (
    <aside className={cn(
      "h-screen flex flex-col items-center py-8 bg-white border-r border-gray-50 shrink-0 transition-all duration-300",
      isCollapsed ? "w-12" : "w-20"
    )}>
      <div className="mb-10">
         <div className={cn(
           "rounded-2xl bg-indigo-600 flex items-center justify-center text-white font-black text-sm shadow-lg shadow-indigo-500/20 transition-all",
           isCollapsed ? "w-8 h-8 text-[10px]" : "w-10 h-10"
         )}>A4</div>
      </div>
      <div className="flex-1 flex flex-col gap-8">
        {topNav.map(({ id, Icon }) => (
          <button
            key={id}
            onClick={() => onPageChange(id)}
            className={cn(
              "p-2 rounded-lg transition-colors group relative",
              currentPage === id ? "text-accent bg-indigo-50" : "text-gray-400 hover:text-gray-600 hover:bg-gray-50"
            )}
          >
            <Icon size={isCollapsed ? 20 : 24} />
            <span className="absolute left-14 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">
              {PAGE_LABELS[id] ?? id}
            </span>
          </button>
        ))}
      </div>
      
      <div className="flex flex-col gap-8 pb-4">
        {bottomNav.map(({ id, Icon }) => (
          <button
            key={id}
            onClick={() => onPageChange(id)}
            className={cn(
              "p-2 rounded-lg transition-colors group relative",
              currentPage === id ? "text-accent bg-indigo-50" : "text-gray-400 hover:text-gray-600 hover:bg-gray-50"
            )}
          >
            <Icon size={isCollapsed ? 20 : 24} />
            <span className="absolute left-14 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">
              {PAGE_LABELS[id] ?? id}
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}
