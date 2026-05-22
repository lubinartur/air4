/**
 * LiveFeed — cross-sphere activity stream for the Overview page.
 *
 * Renders items returned by GET /api/feed grouped into TODAY / YESTERDAY /
 * dated buckets. Each row has a colored accent bar + type-tinted icon
 * square, a title/subtitle column, and a meta column showing either a
 * type pill or a signed amount plus an exact local time.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Briefcase,
  Calendar,
  CreditCard,
  History,
  RefreshCw,
  Sparkles,
  Terminal,
  Trash2,
  Upload as UploadIcon,
  type LucideIcon,
} from "lucide-react";
import { fetchFeed, type FeedItem } from "../lib/api";
import { cn } from "../lib/utils";

const DIGEST_LIMIT = 8;

// A coarser grouping than `item.type` — splits transactions by direction
// and events by domain so the digest can show e.g. latest spend AND latest
// income as separate categories.
function categoryOf(item: FeedItem): string {
  if (item.type === "transaction") {
    return item.icon === "trending-up" ? "tx_income" : "tx_spend";
  }
  if (item.type === "event") {
    const hint = (item.icon ?? "").toLowerCase();
    if (hint === "activity") return "event_health";
    if (hint === "briefcase") return "event_work";
    if (hint === "credit-card") return "event_finance";
    return "event_other";
  }
  return item.type;
}

type TypeStyle = {
  accent: string; // background for the vertical accent bar
  iconWrap: string; // background for the icon square
  iconColor: string; // foreground for the icon glyph
  pillBg: string; // background for the right-side label pill
  pillFg: string; // foreground for the right-side label pill / amount
  label: string; // right-side label text (empty for transactions)
  Icon: LucideIcon;
};

const FALLBACK: TypeStyle = {
  accent: "bg-gray-300",
  iconWrap: "bg-gray-100",
  iconColor: "text-gray-600",
  pillBg: "bg-gray-100",
  pillFg: "text-gray-600",
  label: "СОБЫТИЕ",
  Icon: Calendar,
};

function styleFor(item: FeedItem): TypeStyle {
  if (item.type === "transaction") {
    const incoming = item.icon === "trending-up";
    return incoming
      ? {
          accent: "bg-green-500",
          iconWrap: "bg-green-50",
          iconColor: "text-green-600",
          pillBg: "",
          pillFg: "text-green-600",
          label: "",
          Icon: ArrowUpRight,
        }
      : {
          accent: "bg-red-500",
          iconWrap: "bg-red-50",
          iconColor: "text-red-500",
          pillBg: "",
          pillFg: "text-red-500",
          label: "",
          Icon: ArrowDownRight,
        };
  }
  if (item.type === "subscription") {
    return {
      accent: "bg-orange-500",
      iconWrap: "bg-orange-50",
      iconColor: "text-orange-600",
      pillBg: "bg-orange-50",
      pillFg: "text-orange-700",
      label: "ПОДПИСКА",
      Icon: item.icon === "trash" ? Trash2 : RefreshCw,
    };
  }
  if (item.type === "upload") {
    return {
      accent: "bg-blue-500",
      iconWrap: "bg-blue-50",
      iconColor: "text-blue-500",
      pillBg: "bg-blue-50",
      pillFg: "text-blue-700",
      label: "ВЫПИСКА",
      Icon: UploadIcon,
    };
  }
  if (item.type === "project_log") {
    return {
      accent: "bg-purple-500",
      iconWrap: "bg-purple-50",
      iconColor: "text-purple-600",
      pillBg: "bg-purple-50",
      pillFg: "text-purple-700",
      label: "ЛОГ ПРОЕКТА",
      Icon: Terminal,
    };
  }
  if (item.type === "observation") {
    return {
      accent: "bg-[#6366F1]",
      iconWrap: "bg-indigo-50",
      iconColor: "text-[#6366F1]",
      pillBg: "bg-indigo-50",
      pillFg: "text-[#6366F1]",
      label: "НАБЛЮДЕНИЕ AIR4",
      Icon: Sparkles,
    };
  }

  // events — disambiguate by the icon hint the backend attached
  const hint = (item.icon ?? "").toLowerCase();
  if (hint === "activity") {
    return {
      accent: "bg-green-500",
      iconWrap: "bg-green-50",
      iconColor: "text-green-600",
      pillBg: "bg-green-50",
      pillFg: "text-green-700",
      label: "ЗДОРОВЬЕ",
      Icon: Activity,
    };
  }
  if (hint === "briefcase") {
    return {
      accent: "bg-amber-500",
      iconWrap: "bg-amber-50",
      iconColor: "text-amber-600",
      pillBg: "bg-amber-50",
      pillFg: "text-amber-700",
      label: "РАБОТА",
      Icon: Briefcase,
    };
  }
  if (hint === "credit-card") {
    return {
      accent: "bg-orange-500",
      iconWrap: "bg-orange-50",
      iconColor: "text-orange-600",
      pillBg: "bg-orange-50",
      pillFg: "text-orange-700",
      label: "ФИНАНСЫ",
      Icon: CreditCard,
    };
  }
  return FALLBACK;
}

// SQLite serialises `datetime('now')` as `YYYY-MM-DD HH:MM:SS` in UTC.
// Adding the `Z` after swapping the space gives JS a parseable ISO that
// it can then convert to the user's local timezone for display + bucketing.
function parseStamp(iso: string): number | null {
  if (!iso) return null;
  const normalized = iso.includes("T") ? iso : iso.replace(" ", "T") + "Z";
  const ts = Date.parse(normalized);
  return Number.isNaN(ts) ? null : ts;
}

function formatExactTime(iso: string): string {
  const ts = parseStamp(iso);
  if (ts === null) return "";
  return new Date(ts).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function dateBucketLabel(iso: string): { key: string; label: string } {
  const ts = parseStamp(iso);
  if (ts === null) return { key: "unknown", label: "РАНЕЕ" };
  const d = new Date(ts);
  const dayStart = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate()
  ).getTime();
  const now = new Date();
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();
  const dayMs = 86_400_000;
  const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  if (dayStart === todayStart) return { key, label: "СЕГОДНЯ" };
  if (dayStart === todayStart - dayMs) return { key, label: "ВЧЕРА" };
  return {
    key,
    label: d
      .toLocaleDateString("ru-RU", { month: "short", day: "numeric" })
      .toUpperCase(),
  };
}

// Backend titles for transactions read "Spent €45 at Rimi" / "Received
// €3835.00". The redesign moves the amount into the right-meta column,
// so trim the verb out of the title to avoid duplication.
function cleanTitle(item: FeedItem): string {
  if (item.type === "transaction") {
    // Match both English (legacy) and Russian backend titles.
    return item.title.replace(
      /^(Spent|Received|Потрачено|Получено)\s+/i,
      ""
    );
  }
  return item.title;
}

function formatSignedAmount(item: FeedItem): string {
  const amt = Math.abs(item.amount ?? 0);
  const sign = item.icon === "trending-up" ? "+" : "−";
  return `${sign}€${amt.toFixed(2)}`;
}

function FeedRow({ item }: { item: FeedItem }) {
  const style = styleFor(item);
  const { Icon } = style;
  const isTxn = item.type === "transaction";
  return (
    <li className="relative pl-4">
      <span
        className={cn(
          "absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full",
          style.accent
        )}
      />
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "shrink-0 w-9 h-9 rounded-xl flex items-center justify-center",
            style.iconWrap
          )}
        >
          <Icon size={15} className={style.iconColor} strokeWidth={2.5} />
        </span>

        <div className="flex-1 min-w-0 pt-0.5">
          <p className="text-[13px] font-bold text-gray-900 truncate">
            {cleanTitle(item)}
          </p>
          {item.subtitle && (
            <p className="text-[11.5px] text-gray-500 font-medium leading-snug mt-0.5 line-clamp-2">
              {item.subtitle}
            </p>
          )}
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0 pt-0.5">
          {isTxn ? (
            <span
              className={cn(
                "text-[13px] font-extrabold font-mono whitespace-nowrap",
                style.pillFg
              )}
            >
              {formatSignedAmount(item)}
            </span>
          ) : (
            <span
              className={cn(
                "text-[9px] font-black px-2.5 py-1 rounded-md uppercase tracking-wider whitespace-nowrap",
                style.pillBg,
                style.pillFg
              )}
            >
              {style.label}
            </span>
          )}
          <span className="text-[10px] text-gray-400 font-mono font-semibold">
            {formatExactTime(item.created_at)}
          </span>
        </div>
      </div>
    </li>
  );
}

export function LiveFeed() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"digest" | "full">("digest");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchFeed(30)
      .then((res) => {
        if (cancelled) return;
        setItems(res.items ?? []);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Не удалось загрузить ленту";
        setError(msg);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Digest = walk items in recency order, keep first sighting per category,
  // capped at DIGEST_LIMIT. The list is already (type, title)-deduped by
  // the backend so we only need to collapse cross-category repetition here.
  const digestItems = useMemo(() => {
    const seen = new Set<string>();
    const out: FeedItem[] = [];
    for (const it of items) {
      const cat = categoryOf(it);
      if (seen.has(cat)) continue;
      seen.add(cat);
      out.push(it);
      if (out.length >= DIGEST_LIMIT) break;
    }
    return out;
  }, [items]);

  const visible = view === "digest" ? digestItems : items;

  // Date groups are only meaningful in the chronological full view —
  // digest mode is a flat "current state" snapshot.
  const groups = useMemo(() => {
    if (view === "digest") return null;
    const out: Array<{ key: string; label: string; items: FeedItem[] }> = [];
    let cur: { key: string; label: string; items: FeedItem[] } | null = null;
    for (const it of visible) {
      const bucket = dateBucketLabel(it.created_at);
      if (!cur || cur.key !== bucket.key) {
        cur = { key: bucket.key, label: bucket.label, items: [] };
        out.push(cur);
      }
      cur.items.push(it);
    }
    return out;
  }, [view, visible]);

  return (
    <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_16px_rgba(0,0,0,0.06)] md:col-span-2 transition-all duration-300 hover:shadow-md">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <History size={13} className="text-gray-400" strokeWidth={2.5} />
          <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
            Лента активности
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[#6366F1] animate-pulse" />
          <span className="text-[10px] font-black text-[#6366F1] uppercase tracking-wider">
            Реальное время
          </span>
        </div>
      </div>

      {/* Body */}
      {loading && items.length === 0 ? (
        <div className="text-[12px] text-gray-400 py-10 text-center">
          Загрузка активности…
        </div>
      ) : error ? (
        <div className="text-[12px] text-red-500 py-6 text-center">{error}</div>
      ) : items.length === 0 ? (
        <div className="text-[12px] text-gray-400 py-10 text-center">
          Записей пока нет. Загрузите выписку или начните диалог, чтобы наполнить ленту.
        </div>
      ) : (
        <>
          {view === "digest" ? (
            <ul className="space-y-2.5">
              {visible.map((it) => (
                <FeedRow
                  key={`d-${it.type}-${it.created_at}-${it.title}`}
                  item={it}
                />
              ))}
            </ul>
          ) : (
            <div className="space-y-6">
              {(groups ?? []).map((group) => (
                <div key={group.key}>
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                      {group.label}
                    </span>
                    <div className="flex-1 h-px bg-gray-100" />
                  </div>

                  <ul className="space-y-2.5">
                    {group.items.map((it) => (
                      <FeedRow
                        key={`f-${it.type}-${it.created_at}-${it.title}`}
                        item={it}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {items.length > digestItems.length && (
            <div className="pt-4 mt-4 flex justify-center">
              <button
                type="button"
                onClick={() =>
                  setView((prev) => (prev === "digest" ? "full" : "digest"))
                }
                className="text-[10px] font-black text-[#6366F1] uppercase tracking-wider hover:text-indigo-800"
              >
                {view === "digest"
                  ? `Показать всё (${items.length})`
                  : "Свернуть до дайджеста"}
              </button>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between pt-4 mt-5 border-t border-gray-100">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider font-mono">
              События синхронизированы ({items.length}{" "}
              {items.length % 10 === 1 && items.length % 100 !== 11
                ? "запись"
                : items.length % 10 >= 2 && items.length % 10 <= 4 && (items.length % 100 < 12 || items.length % 100 > 14)
                ? "записи"
                : "записей"})
            </span>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              <span className="text-[10px] font-black text-[#6366F1] uppercase tracking-wider">
                Поток подключён
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
