import { NAVIGATION, PAGE_LABELS } from "../constants";
import { Page } from "../types";
import { cn } from "../lib/utils";

interface SidebarProps {
  currentPage: Page;
  onPageChange: (page: Page) => void;
  isCollapsed?: boolean;
}

export function Sidebar({ currentPage, onPageChange }: SidebarProps) {
  const topNav = NAVIGATION.slice(0, -1);
  const bottomNav = NAVIGATION.slice(-1);

  const navButtonClass = (active: boolean) =>
    cn(
      "p-2 rounded-[10px] transition-all duration-200 ease-out hover:scale-110 group relative",
      active
        ? "text-[#f97316] bg-[#f97316]/15"
        : "text-white/40 hover:text-white hover:bg-white/10",
    );

  const tooltipClass =
    "absolute left-12 bg-[#1a1a24] border border-[#2a2a3a] text-[#f1f5f9] " +
    "text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none " +
    "transition-opacity whitespace-nowrap z-50";

  return (
    <aside
      className="w-16 flex flex-col items-center py-6 shrink-0 my-2 ml-2 rounded-[20px] h-[calc(100vh-16px)] border-r border-white/[0.06]"
      style={{
        background: "#13131f",
      }}
    >
      <div className="mb-10">
        <div className="w-9 h-9 flex items-center justify-center overflow-hidden">
          <img
            src="/ar4-test.svg"
            alt="AIR4"
            className="w-full h-full object-contain"
          />
        </div>
      </div>

      <div className="flex-1 flex flex-col gap-2">
        {topNav.map(({ id, Icon }) => (
          <button
            key={id}
            onClick={() => onPageChange(id)}
            className={navButtonClass(currentPage === id)}
          >
            <Icon size={20} />
            <span className={tooltipClass}>{PAGE_LABELS[id] ?? id}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2 pb-2">
        {bottomNav.map(({ id, Icon }) => (
          <button
            key={id}
            onClick={() => onPageChange(id)}
            className={navButtonClass(currentPage === id)}
          >
            <Icon size={20} />
            <span className={tooltipClass}>{PAGE_LABELS[id] ?? id}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
