import { Sparkles } from "lucide-react";
import { cn } from "../lib/utils";
import type { PendingChatAction } from "../lib/api";

type Props = {
  action: PendingChatAction;
  busy?: boolean;
  onConfirm: (action: PendingChatAction) => void;
  onCancel: (action: PendingChatAction) => void;
  className?: string;
};

export function PendingActionBar({
  action,
  busy = false,
  onConfirm,
  onCancel,
  className,
}: Props) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border border-[#f97316]/30",
        "bg-[#1e1e2e] px-3 py-2.5",
        className,
      )}
    >
      <Sparkles size={16} className="text-[#f97316] shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#f97316]">
          AIR4 хочет
        </p>
        <p className="text-[13px] text-[#e5e5e5] leading-snug mt-0.5">
          {action.description}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          disabled={busy}
          onClick={() => onCancel(action)}
          className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-[#94a3b8] hover:text-white hover:bg-white/5 disabled:opacity-40 transition-colors"
        >
          Отмена
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            console.log("Confirm clicked, action:", action);
            onConfirm(action);
          }}
          className="px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-[#f97316] text-white hover:brightness-110 disabled:opacity-40 transition-all"
        >
          Подтвердить
        </button>
      </div>
    </div>
  );
}
