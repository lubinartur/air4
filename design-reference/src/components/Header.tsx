import { Plus } from "lucide-react";
import { Page } from "../types";
import { PAGE_LABELS } from "../constants";

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
  // The decorative title strip is hidden on CSVUpload and on pages that
  // render their own inline header. The energy-state control now lives in
  // ChatPanel (desktop) and FullscreenChat — no longer in this header.
  const showStrip =
    currentPage !== "CSVUpload" &&
    !PAGES_WITH_OWN_HEADER.includes(currentPage);

  return (
    <>
      {showStrip && (
        <header className="flex items-center justify-between mb-10">
          <div>
            <h1 className="text-4xl font-black text-[#f1f5f9] tracking-tight">
              {PAGE_LABELS[currentPage] ?? currentPage}
            </h1>
          </div>
          <button className="flex items-center gap-2 bg-[#f97316] text-white px-5 py-2.5 rounded-[10px] font-bold text-[13px] shadow-lg shadow-[#f97316]/20 hover:bg-[#ea6a06] transition-all uppercase tracking-wider">
            <Plus size={18} />
            Добавить событие
          </button>
        </header>
      )}
    </>
  );
}
