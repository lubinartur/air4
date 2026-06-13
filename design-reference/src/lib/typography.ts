/**
 * AIR4 typography tokens.
 *
 * Single source of truth for repeated className combos across pages.
 * Use via the `t` export: <h1 className={t.pageTitle}>.
 * Compose with overrides via cn(): <p className={cn(t.pageSub, "mt-0.5")}>.
 */

export const t = {
  // Page banner heading + subtitle
  pageTitle: "text-2xl font-black text-[#f1f5f9] tracking-tight",
  pageSub: "text-[11px] font-bold text-[#94a3b8] uppercase tracking-widest",

  // Section labels and titles inside cards
  cardLabel: "text-[11px] font-bold text-[#64748b] uppercase tracking-wider",
  cardTitle: "text-base font-bold text-[#f1f5f9]",

  // Hero metrics (big mono numbers)
  hero: "text-4xl font-extrabold text-[#f1f5f9] font-mono tracking-tight",
  heroSub: "text-sm font-semibold text-[#94a3b8]",

  // Data rows
  rowTitle: "text-[13px] font-semibold text-[#f1f5f9]",
  rowMeta: "text-[11px] font-medium text-[#94a3b8]",
  rowMono: "text-[13px] font-mono font-semibold text-[#f1f5f9]",

  // Body copy
  body: "text-[13px] font-medium text-[#cbd5e1] leading-relaxed",
  bodySmall: "text-[11px] font-medium text-[#94a3b8]",

  // Status pills
  badge: "text-[9px] font-black uppercase tracking-wider",

  // Soft chip used at the bottom of Overview cards. Sentence case (NOT
  // uppercase), no border on the wrapper — chip itself is the affordance.
  // Compose multiple pills inside `flex items-center gap-2`.
  footerPill:
    "bg-white/5 text-[#94a3b8] text-[11px] font-medium px-2 py-0.5 rounded-full",

  // Navigation/action links
  link: "text-[10px] font-black text-[#f97316] uppercase tracking-wider",
} as const;
