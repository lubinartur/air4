import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { NAVIGATION, PAGE_LABELS } from "../constants";
import { fetchObserverStatus } from "../lib/api";
import { pathFromPage } from "../lib/navigation";
import { Page } from "../types";
import { cn } from "../lib/utils";

interface SidebarProps {
  currentPage: Page;
  onPageChange: (page: Page) => void;
  isCollapsed?: boolean;
}

export function Sidebar({ currentPage, onPageChange }: SidebarProps) {
  const location = useLocation();
  const topNav = NAVIGATION.slice(0, -1);
  const bottomNav = NAVIGATION.slice(-1);
  const [observerActive, setObserverActive] = useState(false);

  useEffect(() => {
    const refresh = () => {
      fetchObserverStatus()
        .then((s) => setObserverActive(s.enabled && s.running))
        .catch(() => setObserverActive(false));
    };
    refresh();
    const id = setInterval(refresh, 30000);
    return () => clearInterval(id);
  }, []);

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

  const isActive = (id: Page) =>
    currentPage === id || location.pathname === pathFromPage(id);

  return (
    <aside
      className="w-16 flex flex-col items-center py-6 shrink-0 h-screen bg-[#0f0f14] border-r border-white/[0.06]"
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
          <Link
            key={id}
            to={pathFromPage(id)}
            className={navButtonClass(isActive(id))}
          >
            <Icon size={20} />
            <span className={tooltipClass}>{PAGE_LABELS[id] ?? id}</span>
          </Link>
        ))}
      </div>

      <div className="flex flex-col gap-2 pb-2 items-center">
        <span
          className={cn(
            "w-1.5 h-1.5 rounded-full mb-1",
            observerActive
              ? "bg-[#22c55e] animate-pulse"
              : "bg-white/20",
          )}
          title={
            observerActive
              ? "Observer активен"
              : "Observer выключен"
          }
        />
        {bottomNav.map(({ id, Icon }) => (
          <Link
            key={id}
            to={pathFromPage(id)}
            className={navButtonClass(isActive(id))}
          >
            <Icon size={20} />
            <span className={tooltipClass}>{PAGE_LABELS[id] ?? id}</span>
          </Link>
        ))}
      </div>
    </aside>
  );
}
