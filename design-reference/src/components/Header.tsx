import { Plus } from "lucide-react";
import { Page } from "../types";

interface HeaderProps {
  currentPage: Page;
}

export function Header({ currentPage }: HeaderProps) {
  if (currentPage === "CSVUpload") return null;

  return (
    <header className="flex items-center justify-between mb-10">
      <div>
        {!["Finance", "Projects", "Health", "Goals", "Dilemmas", "Patterns", "Memory", "Settings"].includes(currentPage) && (
          <h1 className="text-4xl font-black text-[#111827] tracking-tight">{currentPage}</h1>
        )}
        <p className="text-[11px] font-bold text-[#9ca3af] uppercase tracking-[0.1em] mt-1">Thinking Companion</p>
      </div>
      <button className="flex items-center gap-2 bg-[#6366f1] text-white px-5 py-2.5 rounded-[10px] font-bold text-[13px] shadow-lg shadow-indigo-500/20 hover:bg-indigo-700 transition-all uppercase tracking-wider">
        <Plus size={18} />
        Add event
      </button>
    </header>
  );
}
