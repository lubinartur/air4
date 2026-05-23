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
  if (currentPage === "CSVUpload") return null;
  // Pages in PAGES_WITH_OWN_HEADER render an inline page header inside
  // their own component. Skipping this strip entirely on those pages
  // lets the inline header sit directly under <main>'s p-8 (≈32px)
  // instead of being pushed down by ~80px of decorative chrome (the
  // unwired "Добавить событие" button + the strip's mb-10).
  if (PAGES_WITH_OWN_HEADER.includes(currentPage)) return null;

  return (
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
  );
}
