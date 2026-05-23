import { LucideIcon, Upload, Plus, Activity, Repeat } from "lucide-react";
import { cn } from "../lib/utils";

export type OverviewEmptyType = "finance" | "projects" | "health" | "patterns";

const CONFIG: Record<
  OverviewEmptyType,
  {
    icon: LucideIcon;
    title: string;
    subtext: string;
    button?: string;
    extra?: string;
    extraClassName?: string;
  }
> = {
  finance: {
    icon: Upload,
    title: "Выписки пока не загружены",
    subtext: "Загрузите первую выписку Swedbank, чтобы увидеть, куда уходят деньги",
    button: "Загрузить выписку",
  },
  projects: {
    icon: Plus,
    title: "Проектов пока нет",
    subtext: "Добавьте проект через чат",
    button: "Добавить проект",
  },
  health: {
    icon: Activity,
    title: "Данных о здоровье пока нет",
    subtext: "Напишите AIR4 в чате свой вес или залогируйте тренировку.",
  },
  patterns: {
    icon: Repeat,
    title: "Собираем данные...",
    subtext: "Продолжайте логировать.",
    extra: "Паттерны проявятся через 2–3 недели реального использования",
    extraClassName: "text-amber-500",
  },
};

type Props = {
  type: OverviewEmptyType;
  onAction?: () => void;
  compact?: boolean;
};

export function OverviewCardEmpty({ type, onAction, compact }: Props) {
  const c = CONFIG[type];
  const Icon = c.icon;

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center flex-1",
        compact ? "py-4" : "py-8"
      )}
    >
      <div className={cn("rounded-[16px] bg-gray-50 text-[#d1d5db]", compact ? "p-3 mb-3" : "p-5 mb-5")}>
        <Icon size={compact ? 28 : 40} strokeWidth={1.5} />
      </div>
      <h3 className={cn("font-bold text-[#111827] leading-tight", compact ? "text-[14px]" : "text-[16px]")}>
        {c.title}
      </h3>
      <p
        className={cn(
          "text-[#9ca3af] font-medium mt-1.5 leading-relaxed max-w-[220px]",
          compact ? "text-[12px]" : "text-[13px]"
        )}
      >
        {c.subtext}
      </p>
      {c.button && onAction && (
        <button
          type="button"
          onClick={(e) => {
            // The empty-state CTA typically points to a different page than
            // its host card (e.g. Finance card → CSVUpload, Projects card →
            // chat). When the host card is itself clickable we must stop
            // propagation so the card's onClick doesn't override the user's
            // explicit choice and bounce them to the wrong page.
            e.stopPropagation();
            onAction();
          }}
          className="mt-5 flex items-center gap-2 bg-[#6366f1] text-white px-4 py-2 rounded-[10px] font-bold text-[12px] shadow-lg shadow-indigo-500/20 hover:bg-indigo-700 transition-all uppercase tracking-wider"
        >
          {type === "finance" ? <Upload size={14} /> : <Plus size={14} />}
          {c.button}
        </button>
      )}
      {c.extra && (
        <p
          className={cn(
            "mt-4 text-[10px] font-bold uppercase tracking-[0.1em]",
            c.extraClassName ?? "text-[#9ca3af]"
          )}
        >
          {c.extra}
        </p>
      )}
    </div>
  );
}
