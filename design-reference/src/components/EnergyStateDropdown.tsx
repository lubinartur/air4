import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../lib/utils";

// --- Energy State (AIR4 Советник) ---------------------------------------
// Controls how proactive AIR4 is. Four escalating modes, persisted to
// localStorage AND the backend (GET/PUT /api/air4/mode), plus a
// Do-Not-Disturb timer. Default mode is `normal`.
//
// Shared between Header.tsx (fixed top-right chrome) and FullscreenChat.tsx
// (inline in the chat header). The `className` / `buttonClassName` props
// let each caller place the control without changing the internal logic.

type EnergyMode = "quiet" | "normal" | "active" | "jarvis";

const ENERGY_MODES: {
  id: EnergyMode;
  icon: string;
  label: string;
  desc: string;
}[] = [
  { id: "quiet", icon: "🟢", label: "Тихий", desc: "Минимум вмешательства" },
  { id: "normal", icon: "🟡", label: "Обычный", desc: "Баланс по умолчанию" },
  { id: "active", icon: "🟠", label: "Активный", desc: "Чаще подсказывает" },
  { id: "jarvis", icon: "🔴", label: "Jarvis", desc: "Максимальная вовлечённость" },
];

const ENERGY_STORAGE_KEY = "air4_energy_mode";
const DND_STORAGE_KEY = "air4_dnd_until";

const DND_OPTIONS: { id: string; label: string; ms: number | "evening" }[] = [
  { id: "1h", label: "1 час", ms: 60 * 60 * 1000 },
  { id: "evening", label: "До вечера", ms: "evening" },
  { id: "24h", label: "24 часа", ms: 24 * 60 * 60 * 1000 },
];

function readStoredMode(): EnergyMode {
  if (typeof window === "undefined") return "jarvis";
  const raw = window.localStorage.getItem(ENERGY_STORAGE_KEY);
  if (raw === "quiet" || raw === "normal" || raw === "active" || raw === "jarvis") {
    return raw;
  }
  return "jarvis";
}

interface EnergyStateDropdownProps {
  /** Wrapper className — controls placement (e.g. fixed vs relative). */
  className?: string;
  /** Trigger button className. */
  buttonClassName?: string;
}

const DEFAULT_BUTTON_CLASS =
  "flex items-center gap-2 bg-[#1e1e2e] border border-white/10 shadow-sm rounded-full pl-2.5 pr-3 py-2 hover:bg-white/5 transition-colors";

export function EnergyStateDropdown({
  className = "relative",
  buttonClassName = DEFAULT_BUTTON_CLASS,
}: EnergyStateDropdownProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<EnergyMode>("jarvis");
  const [dndUntil, setDndUntil] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Hydrate from localStorage after mount for an instant paint, then
  // fetch the persisted mode from the backend — the DB value takes
  // priority over localStorage and we re-sync localStorage to match.
  useEffect(() => {
    setMode(readStoredMode());
    const rawDnd = window.localStorage.getItem(DND_STORAGE_KEY);
    if (rawDnd) {
      const ts = Number(rawDnd);
      if (Number.isFinite(ts) && ts > Date.now()) {
        setDndUntil(ts);
      } else {
        window.localStorage.removeItem(DND_STORAGE_KEY);
      }
    }

    let cancelled = false;
    fetch("/api/air4/mode")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { mode?: string } | null) => {
        if (cancelled || !data) return;
        const m = data.mode;
        if (m === "quiet" || m === "normal" || m === "active" || m === "jarvis") {
          setMode(m);
          window.localStorage.setItem(ENERGY_STORAGE_KEY, m);
        }
      })
      .catch(() => {
        // Backend unreachable — keep the localStorage value.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Close the dropdown on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selectMode = (next: EnergyMode) => {
    setMode(next);
    window.localStorage.setItem(ENERGY_STORAGE_KEY, next);
    fetch("/api/air4/mode", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: next }),
    }).catch(() => {
      // Optimistic update already applied locally; ignore network errors.
    });
  };

  const applyDnd = (opt: (typeof DND_OPTIONS)[number]) => {
    let until: number;
    if (opt.ms === "evening") {
      const d = new Date();
      d.setHours(20, 0, 0, 0);
      if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
      until = d.getTime();
    } else {
      until = Date.now() + opt.ms;
    }
    setDndUntil(until);
    window.localStorage.setItem(DND_STORAGE_KEY, String(until));
    setOpen(false);
  };

  const clearDnd = () => {
    setDndUntil(null);
    window.localStorage.removeItem(DND_STORAGE_KEY);
  };

  const current = ENERGY_MODES.find((m) => m.id === mode) ?? ENERGY_MODES[1];
  const dndActive = dndUntil != null && dndUntil > Date.now();

  return (
    <div ref={ref} className={className}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={buttonClassName}
        title="AIR4 Советник — режим вовлечённости"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="text-[15px] leading-none">
          {dndActive ? "🌙" : current.icon}
        </span>
        <span className="text-[12px] font-semibold text-[#94a3b8]">
          AIR4 Советник
        </span>
        <ChevronDown
          size={14}
          className={cn(
            "text-[#94a3b8] transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-60 bg-[#1e1e2e] rounded-2xl shadow-xl border border-white/[0.08] p-2 text-left z-50"
        >
          <p className="px-2 pt-1 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-[#64748b]">
            Режим
          </p>
          {ENERGY_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => selectMode(m.id)}
              className={cn(
                "w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left transition-colors",
                m.id === mode ? "bg-[#f97316]/15" : "hover:bg-white/5",
              )}
            >
              <span className="text-[15px] leading-none">{m.icon}</span>
              <span className="flex-1">
                <span className="block text-[13px] font-semibold text-[#f1f5f9]">
                  {m.label}
                </span>
                <span className="block text-[11px] text-[#94a3b8]">{m.desc}</span>
              </span>
              {m.id === mode && (
                <span className="text-[#f97316] text-[12px] font-bold">✓</span>
              )}
            </button>
          ))}

          <div className="my-2 border-t border-white/[0.08]" />

          <p className="px-2 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-[#64748b]">
            Не беспокоить
          </p>
          {dndActive ? (
            <div className="px-2 pb-1">
              <p className="text-[12px] text-[#94a3b8] mb-1.5">
                Активно до{" "}
                {new Date(dndUntil).toLocaleString("ru-RU", {
                  hour: "2-digit",
                  minute: "2-digit",
                  day: "numeric",
                  month: "short",
                })}
              </p>
              <button
                type="button"
                onClick={clearDnd}
                className="text-[12px] font-semibold text-[#f97316] hover:text-[#f97316]"
              >
                Выключить
              </button>
            </div>
          ) : (
            <div className="flex gap-1.5 px-1 pb-1">
              {DND_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => applyDnd(opt)}
                  className="flex-1 text-[11px] font-semibold text-[#94a3b8] bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg py-1.5 transition-colors"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
