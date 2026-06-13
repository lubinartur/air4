import type { LucideIcon } from "lucide-react";
import { cn } from "../lib/utils";

type Props = {
  icon: LucideIcon;
  title: string;
  subtext: string;
  className?: string;
};

export function PageEmptyState({ icon: Icon, title, subtext, className }: Props) {
  return (
    <div
      className={cn(
        "bg-[#13131f] border border-white/5 rounded-[20px] p-12 shadow-[0_2px_12px_rgba(0,0,0,0.08)] flex flex-col items-center justify-center text-center min-h-[320px]",
        className
      )}
    >
      <div className="rounded-[16px] bg-white/5 text-[#64748b] p-5 mb-5">
        <Icon size={40} strokeWidth={1.5} />
      </div>
      <h3 className="text-[18px] font-bold text-[#f1f5f9]">{title}</h3>
      <p className="text-[14px] text-[#94a3b8] font-medium mt-2 max-w-md leading-relaxed">
        {subtext}
      </p>
    </div>
  );
}
