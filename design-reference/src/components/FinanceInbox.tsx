import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, FileText, Loader2, Mail, Wallet } from "lucide-react";
import { cn } from "../lib/utils";
import { t } from "../lib/typography";
import {
  confirmFinanceInvoice,
  fetchFinanceGmailCandidates,
  fetchFinanceInvoices,
  FinanceGmailAuthError,
  formatMoneyAmount,
  type FinanceGmailCandidate,
  type FinanceInvoice,
} from "../lib/api";

export type FinanceInboxProps = {
  onBack?: () => void;
  /** Injected for tests — when set, skips network fetch. */
  invoices?: FinanceInvoice[] | null;
  loading?: boolean;
  error?: string | null;
  /** Test seam for confirm API. */
  onConfirmInvoice?: (invoiceId: number) => Promise<FinanceInvoice>;
  /** Test seam for Gmail discovery. */
  onFetchGmailCandidates?: () => Promise<FinanceGmailCandidate[]>;
};

function statusBadgeClass(status: FinanceInvoice["status"]): string {
  switch (status) {
    case "confirmed":
      return "bg-emerald-500/15 text-emerald-400 border-emerald-500/25";
    case "paid":
      return "bg-sky-500/15 text-sky-400 border-sky-500/25";
    case "cancelled":
      return "bg-white/5 text-[#64748b] border-white/10";
    case "draft":
    default:
      return "bg-[#f97316]/15 text-[#f97316] border-[#f97316]/25";
  }
}

function formatConfidence(value: number | null): string | null {
  if (value === null || Number.isNaN(value)) return null;
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return `${pct}% confidence`;
}

function formatBytes(size: number | null): string {
  if (size === null || size < 0 || Number.isNaN(size)) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatReceived(value: string | null): string {
  if (!value?.trim()) return "Unknown date";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function GmailCandidatesPanel({
  open,
  loading,
  error,
  authError,
  candidates,
  onClose,
}: {
  open: boolean;
  loading: boolean;
  error: string | null;
  authError: boolean;
  candidates: FinanceGmailCandidate[];
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div
      className="bg-[#13131f] rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)] animate-fade-in-up border border-white/5"
      data-testid="gmail-candidates-panel"
    >
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-extrabold text-[#f1f5f9]">
            Gmail candidates
          </h2>
          <p className={cn(t.bodySmall, "mt-0.5")}>
            PDF attachments from the last 90 days — review only
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-[10px] font-black uppercase tracking-wider text-[#94a3b8] hover:text-[#f1f5f9]"
        >
          Close
        </button>
      </div>

      {loading ? (
        <p
          className="text-[14px] text-[#94a3b8] flex items-center gap-2"
          data-testid="gmail-candidates-loading"
        >
          <Loader2 size={14} className="animate-spin" />
          Searching Gmail…
        </p>
      ) : authError ? (
        <p className="text-[14px] text-amber-400" data-testid="gmail-candidates-auth-error">
          {error || "Gmail is not connected."}
        </p>
      ) : error ? (
        <p className="text-[14px] text-red-400" data-testid="gmail-candidates-error">
          {error}
        </p>
      ) : candidates.length === 0 ? (
        <div className="text-center py-6" data-testid="gmail-candidates-empty">
          <p className="text-[14px] font-bold text-[#f1f5f9]">
            No PDF candidates found
          </p>
          <p className={cn(t.bodySmall, "mt-1")}>
            Try again later or check that recent mail has PDF attachments.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-white/5" data-testid="gmail-candidates-list">
          {candidates.map((c) => (
            <li
              key={`${c.gmail_message_id}:${c.attachment_id}`}
              className="py-3.5 first:pt-0 last:pb-0"
              data-testid="gmail-candidate-item"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 space-y-1">
                  <p className={cn(t.rowTitle, "truncate")}>{c.sender}</p>
                  <p className={cn(t.rowMeta, "truncate")}>{c.subject}</p>
                  <p className={cn(t.bodySmall, "truncate")}>{c.filename}</p>
                  <p className="text-[10px] font-medium text-[#64748b]">
                    {formatReceived(c.received_at)} · {formatBytes(c.size_bytes)}
                  </p>
                </div>
                <span
                  className={cn(
                    t.badge,
                    "shrink-0 inline-flex px-2 py-0.5 rounded-md border",
                    c.already_imported
                      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/25"
                      : "bg-white/5 text-[#94a3b8] border-white/10"
                  )}
                >
                  {c.already_imported ? "Imported" : "New"}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function FinanceInboxList({
  invoices,
  confirmingId,
  actionError,
  onConfirm,
}: {
  invoices: FinanceInvoice[];
  confirmingId: number | null;
  actionError: string | null;
  onConfirm: (invoiceId: number) => void;
}) {
  return (
    <div className="space-y-3">
      {actionError ? (
        <p
          className="text-[13px] text-red-400"
          data-testid="finance-inbox-action-error"
        >
          {actionError}
        </p>
      ) : null}
      <ul className="divide-y divide-white/5" data-testid="finance-inbox-list">
        {invoices.map((invoice) => {
          const confidenceLabel = formatConfidence(invoice.confidence);
          const isConfirming = confirmingId === invoice.id;
          return (
            <li
              key={invoice.id}
              className="py-4 first:pt-0 last:pb-0"
              data-testid="finance-inbox-item"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 space-y-1">
                  <p className={cn(t.rowTitle, "truncate")}>
                    {invoice.issuer?.trim() || "Unknown issuer"}
                  </p>
                  <p className={t.rowMeta}>
                    {invoice.due_date?.trim()
                      ? `Due ${invoice.due_date}`
                      : "No due date"}
                  </p>
                  <p className={cn(t.bodySmall, "truncate")}>
                    {invoice.source_filename?.trim() || "Untitled source"}
                  </p>
                  {invoice.obligation_id != null ? (
                    <p
                      className="text-[11px] font-medium text-emerald-400/90"
                      data-testid="finance-inbox-obligation"
                    >
                      Obligation:{" "}
                      {invoice.obligation_name?.trim() ||
                        `#${invoice.obligation_id}`}
                      {invoice.obligation_currency?.trim()
                        ? ` · ${invoice.obligation_currency.trim()}`
                        : ""}
                    </p>
                  ) : null}
                  {confidenceLabel ? (
                    <p className="text-[10px] font-medium text-[#64748b]">
                      {confidenceLabel}
                    </p>
                  ) : null}
                </div>
                <div className="shrink-0 text-right space-y-2">
                  <p className={t.rowMono}>
                    {invoice.amount === null
                      ? "—"
                      : formatMoneyAmount(invoice.amount, invoice.currency)}
                  </p>
                  <span
                    className={cn(
                      t.badge,
                      "inline-flex px-2 py-0.5 rounded-md border",
                      statusBadgeClass(invoice.status)
                    )}
                  >
                    {invoice.status}
                  </span>
                  {invoice.status === "draft" ? (
                    <div>
                      <button
                        type="button"
                        data-testid={`finance-inbox-confirm-${invoice.id}`}
                        disabled={isConfirming || confirmingId !== null}
                        onClick={() => onConfirm(invoice.id)}
                        className="inline-flex items-center gap-1.5 mt-1 px-2.5 py-1 rounded-md border border-[#f97316]/30 bg-[#f97316]/10 text-[#f97316] text-[10px] font-black uppercase tracking-wider hover:bg-[#f97316]/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {isConfirming ? (
                          <>
                            <Loader2
                              size={11}
                              className="animate-spin"
                              data-testid="finance-inbox-confirm-loading"
                            />
                            Confirming…
                          </>
                        ) : (
                          "Confirm"
                        )}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function FinanceInbox({
  onBack,
  invoices: invoicesProp,
  loading: loadingProp,
  error: errorProp,
  onConfirmInvoice,
  onFetchGmailCandidates,
}: FinanceInboxProps) {
  const controlled = invoicesProp !== undefined;
  const [invoices, setInvoices] = useState<FinanceInvoice[]>(
    invoicesProp ?? []
  );
  const [loading, setLoading] = useState(
    controlled ? Boolean(loadingProp) : true
  );
  const [error, setError] = useState<string | null>(
    controlled ? (errorProp ?? null) : null
  );
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [gmailOpen, setGmailOpen] = useState(false);
  const [gmailLoading, setGmailLoading] = useState(false);
  const [gmailError, setGmailError] = useState<string | null>(null);
  const [gmailAuthError, setGmailAuthError] = useState(false);
  const [gmailCandidates, setGmailCandidates] = useState<
    FinanceGmailCandidate[]
  >([]);

  useEffect(() => {
    if (controlled) {
      setInvoices(invoicesProp ?? []);
      setLoading(Boolean(loadingProp));
      setError(errorProp ?? null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchFinanceInvoices()
      .then((data) => {
        if (!cancelled) {
          setInvoices(data.invoices);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load invoices"
          );
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [controlled, invoicesProp, loadingProp, errorProp]);

  const handleConfirm = useCallback(
    async (invoiceId: number) => {
      setActionError(null);
      setConfirmingId(invoiceId);
      const confirmFn = onConfirmInvoice ?? confirmFinanceInvoice;
      try {
        const updated = await confirmFn(invoiceId);
        setInvoices((prev) =>
          prev.map((inv) => (inv.id === invoiceId ? { ...inv, ...updated } : inv))
        );
      } catch (err: unknown) {
        setActionError(
          err instanceof Error ? err.message : "Failed to confirm invoice"
        );
      } finally {
        setConfirmingId(null);
      }
    },
    [onConfirmInvoice]
  );

  const handleImportFromGmail = useCallback(async () => {
    setGmailOpen(true);
    setGmailLoading(true);
    setGmailError(null);
    setGmailAuthError(false);
    setGmailCandidates([]);
    try {
      if (onFetchGmailCandidates) {
        const rows = await onFetchGmailCandidates();
        setGmailCandidates(rows);
      } else {
        const data = await fetchFinanceGmailCandidates();
        setGmailCandidates(data.candidates);
      }
    } catch (err: unknown) {
      if (err instanceof FinanceGmailAuthError) {
        setGmailAuthError(true);
        setGmailError(err.message);
      } else {
        setGmailError(
          err instanceof Error ? err.message : "Failed to search Gmail"
        );
      }
    } finally {
      setGmailLoading(false);
    }
  }, [onFetchGmailCandidates]);

  return (
    <div className="flex flex-col gap-8 pb-10">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 animate-fade-in-up animate-delay-1">
        <div className="flex items-center gap-2.5">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back"
              className="p-2.5 rounded-xl text-[#94a3b8] hover:bg-white/5 hover:text-[#f1f5f9] transition-colors"
            >
              <ArrowLeft size={18} />
            </button>
          ) : (
            <div className="p-2.5 bg-[#f97316]/15 border border-[#f97316]/30 text-[#f97316] rounded-xl">
              <Wallet size={22} />
            </div>
          )}
          <div>
            <h1 className={t.pageTitle}>Finance</h1>
            <p className={cn(t.pageSub, "mt-0.5")}>
              Documents detected from chat
            </p>
          </div>
        </div>
        <button
          type="button"
          data-testid="finance-inbox-gmail-import"
          onClick={() => {
            void handleImportFromGmail();
          }}
          className="flex items-center gap-2 bg-white/5 border border-white/10 text-[#cbd5e1] px-4 py-2 rounded-[10px] font-bold text-[12px] hover:bg-white/10 transition-all uppercase tracking-wider"
        >
          <Mail size={14} />
          Import from Gmail
        </button>
      </div>

      <GmailCandidatesPanel
        open={gmailOpen}
        loading={gmailLoading}
        error={gmailError}
        authError={gmailAuthError}
        candidates={gmailCandidates}
        onClose={() => setGmailOpen(false)}
      />

      <div className="bg-[#13131f] rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)] animate-fade-in-up animate-delay-2">
        {loading ? (
          <p className="text-[14px] text-[#94a3b8]" data-testid="finance-inbox-loading">
            Loading…
          </p>
        ) : error ? (
          <p
            className="text-[14px] text-red-400"
            data-testid="finance-inbox-error"
          >
            {error}
          </p>
        ) : invoices.length === 0 ? (
          <div className="text-center py-8" data-testid="finance-inbox-empty">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 text-[#94a3b8]">
              <FileText size={18} />
            </div>
            <p className="text-[15px] font-bold text-[#f1f5f9]">
              No documents yet
            </p>
            <p className={cn(t.bodySmall, "mt-1.5")}>
              Upload a PDF or image in chat to extract an invoice.
            </p>
          </div>
        ) : (
          <FinanceInboxList
            invoices={invoices}
            confirmingId={confirmingId}
            actionError={actionError}
            onConfirm={(id) => {
              void handleConfirm(id);
            }}
          />
        )}
      </div>
    </div>
  );
}
