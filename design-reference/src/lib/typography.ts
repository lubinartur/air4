/**
 * AIR4 typography tokens.
 *
 * Single source of truth for repeated className combos across pages.
 * Use via the `t` export: <h1 className={t.pageTitle}>.
 * Compose with overrides via cn(): <p className={cn(t.pageSub, "mt-0.5")}>.
 */

export const t = {
  // Page banner heading + subtitle
  pageTitle: "text-2xl font-black text-gray-900 tracking-tight",
  pageSub: "text-[11px] font-bold text-gray-400 uppercase tracking-widest",

  // Section labels and titles inside cards
  cardLabel: "text-[11px] font-bold text-gray-400 uppercase tracking-wider",
  cardTitle: "text-base font-bold text-gray-900",

  // Hero metrics (big mono numbers)
  hero: "text-4xl font-extrabold text-gray-900 font-mono tracking-tight",
  heroSub: "text-sm font-semibold text-gray-500",

  // Data rows
  rowTitle: "text-[13px] font-semibold text-gray-800",
  rowMeta: "text-[11px] font-medium text-gray-400",
  rowMono: "text-[13px] font-mono font-semibold text-gray-900",

  // Body copy
  body: "text-[13px] font-medium text-gray-600 leading-relaxed",
  bodySmall: "text-[11px] font-medium text-gray-500",

  // Status pills
  badge: "text-[9px] font-black uppercase tracking-wider",

  // Navigation/action links
  link: "text-[10px] font-black text-indigo-600 uppercase tracking-wider",
} as const;
