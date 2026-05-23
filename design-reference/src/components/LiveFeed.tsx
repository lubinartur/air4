/**
 * LiveFeed — cross-sphere activity stream for the Overview page.
 *
 * Renders items returned by GET /api/feed grouped into TODAY / YESTERDAY /
 * dated buckets. Each row has a colored accent bar + type-tinted icon
 * square, a title/subtitle column, and a meta column showing either a
 * type pill or a signed amount plus an exact local time.
 */

import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Briefcase,
  Calendar,
  ChevronRight,
  CreditCard,
  RefreshCw,
  Sparkles,
  Terminal,
  Trash2,
  Upload as UploadIcon,
  type LucideIcon,
} from "lucide-react";
import { fetchFeed, type FeedItem } from "../lib/api";
import { t } from "../lib/typography";
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
  iconWrap: string; // background for the icon square
  iconColor: string; // foreground for the icon glyph
  pillBg: string; // background for the right-side label pill
  pillFg: string; // foreground for the right-side label pill / amount
  label: string; // right-side label text (empty for transactions)
  Icon: LucideIcon;
};

const FALLBACK: TypeStyle = {
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
          iconWrap: "bg-green-50",
          iconColor: "text-green-600",
          pillBg: "",
          pillFg: "text-green-600",
          label: "",
          Icon: ArrowUpRight,
        }
      : {
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

// NOTE: `dateBucketLabel` (СЕГОДНЯ / ВЧЕРА / dated headers) was removed
// alongside the chronological "full" feed view. If the Memory page or any
// other surface needs grouped-by-day rendering, lift that helper into
// `../lib/format` so callers don't reinvent it.

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
    <li>
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

/** Optional click handler for the entire LiveFeed card. When supplied (used
 *  from the Overview dashboard to navigate to Memory), the outer container
 *  becomes a `role="button"` div, gets the standard clickable-card hover
 *  treatment, and every internal interactive element (view-toggle button)
 *  stops propagation so it can keep doing its in-card job.
 *
 *  `digestLimit` lets the host decide how many rows to keep — narrow column
 *  layouts (e.g. the 1/3-width Overview slot) want ~3, wider ones can use
 *  the default. Capped at DIGEST_LIMIT so callers can't accidentally
 *  render a list longer than the deduplicated category count.
 */
type LiveFeedProps = {
  onCardClick?: () => void;
  digestLimit?: number;
};

export function LiveFeed({
  onCardClick,
  digestLimit = DIGEST_LIMIT,
}: LiveFeedProps = {}) {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cardClickable = typeof onCardClick === "function";
  const handleCardClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!onCardClick) return;
    // Don't navigate when the click came from a nested interactive element.
    // The card has no view-toggle anymore — the full feed lives on the
    // Memory page (where `onCardClick` navigates to) — but this guard is
    // cheap insurance for any future inner button.
    if ((e.target as HTMLElement).closest("button")) return;
    onCardClick();
  };
  const handleCardKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!onCardClick) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onCardClick();
    }
  };

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
  // The "full" chronological view used to live behind a toggle but was
  // removed when the whole card became click-to-navigate; the Memory page
  // is now the canonical place to see every event.
  const effectiveLimit = Math.min(
    Math.max(1, Math.floor(digestLimit)),
    DIGEST_LIMIT,
  );
  const digestItems = useMemo(() => {
    const seen = new Set<string>();
    const out: FeedItem[] = [];
    for (const it of items) {
      const cat = categoryOf(it);
      if (seen.has(cat)) continue;
      seen.add(cat);
      out.push(it);
      if (out.length >= effectiveLimit) break;
    }
    return out;
  }, [items, effectiveLimit]);

  return (
    <div
      role={cardClickable ? "button" : undefined}
      tabIndex={cardClickable ? 0 : undefined}
      aria-label={cardClickable ? "Открыть страницу памяти" : undefined}
      onClick={cardClickable ? handleCardClick : undefined}
      onKeyDown={cardClickable ? handleCardKey : undefined}
      className={cn(
        "bg-white rounded-[20px] p-6 shadow-[0_2px_16px_rgba(0,0,0,0.06)]",
        cardClickable
          ? "group/card cursor-pointer border border-transparent hover:border-[#6366F1]/30 hover:shadow-[0_6px_24px_rgba(0,0,0,0.08)] hover:-translate-y-[1px] transition-all duration-150 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6366F1]/40"
          : "transition-all duration-300 hover:shadow-md"
      )}
    >
      {/* Header — blue Activity badge mirrors the green Wallet / blue
          Briefcase badges on the other Overview cards so each card has
          its own colored marker in the same w-6 h-6 rounded-lg slot.
          `min-w-0` lets the title truncate cleanly before the chevron
          if a future locale string runs long. */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2 min-w-0">
          <div className="shrink-0 w-6 h-6 rounded-lg bg-blue-50 text-blue-500 flex items-center justify-center">
            <Activity size={14} className="fill-blue-100" />
          </div>
          <span className="text-lg font-extrabold text-gray-900">
            Активность
          </span>
        </div>
        {cardClickable && (
          <ChevronRight
            size={14}
            strokeWidth={2.5}
            className="text-gray-300 group-hover/card:text-[#6366F1] transition-colors shrink-0"
          />
        )}
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
          <ul className="space-y-2.5">
            {digestItems.map((it) => (
              <FeedRow
                key={`d-${it.type}-${it.created_at}-${it.title}`}
                item={it}
              />
            ))}
          </ul>

          {/* Footer — soft pill chips matching the other Overview card
              footers (Finance / Projects / Patterns). The status pill
              keeps an inline green pulse so "поток подключён" still reads
              as a live signal, not a static label. */}
          <div className="mt-4 flex items-center gap-2 flex-wrap">
            <span className={t.footerPill}>
              {items.length}{" "}
              {items.length % 10 === 1 && items.length % 100 !== 11
                ? "запись"
                : items.length % 10 >= 2 && items.length % 10 <= 4 && (items.length % 100 < 12 || items.length % 100 > 14)
                ? "записи"
                : "записей"}
            </span>
            <span className={cn(t.footerPill, "inline-flex items-center gap-1.5")}>
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              Поток подключён
            </span>
          </div>
        </>
      )}
    </div>
  );
}
