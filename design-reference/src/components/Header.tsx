import { Plus } from "lucide-react";
import { Page } from "../types";
import { PAGE_LABELS } from "../constants";
import { EnergyStateDropdown } from "./EnergyStateDropdown";

interface HeaderProps {
  currentPage: Page;
}

const PAGES_WITH_OWN_HEADER = [
  // Overview renders its own page header (icon + title + subtitle) in
  // OverviewDashboard.tsx so it can share an identical structure with
  // Finance — switching tabs no longer makes the title jump.
  "Overview",
  "Finance",
  "Projects",
  "Health",
  "Sport",
  "Goals",
  "Dilemmas",
  "Patterns",
  "Memory",
  "Profile",
  "Settings",
];

export function Header({ currentPage }: HeaderProps) {
  // The energy-state control is part of the persistent app chrome, so
  // it renders on every page (it's fixed-position and doesn't affect
  // layout flow). The decorative title strip below keeps its original
  // behavior: hidden on CSVUpload and on pages that render their own
  // inline header.
  const showStrip =
    currentPage !== "CSVUpload" &&
    !PAGES_WITH_OWN_HEADER.includes(currentPage);

  return (
    <>
      <EnergyStateDropdown
        className="fixed top-5 right-6 z-50"
        buttonClassName="flex items-center gap-2 bg-white border border-gray-100 shadow-sm rounded-full pl-2.5 pr-3 py-1.5 hover:shadow-md transition-shadow"
      />
      {showStrip && (
        <header className="flex items-center justify-between mb-10">
          <div>
            <h1 className="text-4xl font-black text-[#111827] tracking-tight">
              {PAGE_LABELS[currentPage] ?? currentPage}
            </h1>
          </div>
          <button className="flex items-center gap-2 bg-[#6366f1] text-white px-5 py-2.5 rounded-[10px] font-bold text-[13px] shadow-lg shadow-indigo-500/20 hover:bg-indigo-700 transition-all uppercase tracking-wider">
            <Plus size={18} />
            Добавить событие
          </button>
        </header>
      )}
    </>
  );
}
