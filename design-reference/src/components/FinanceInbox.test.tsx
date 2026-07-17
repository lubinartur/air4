import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FinanceInbox } from "./FinanceInbox";
import type { FinanceInvoice } from "../lib/api";

afterEach(() => {
  cleanup();
});

const SAMPLE: FinanceInvoice[] = [
  {
    id: 1,
    issuer: "ACME OÜ",
    invoice_number: "INV-1",
    amount: 120.5,
    currency: "EUR",
    issue_date: "2026-07-01",
    due_date: "2026-07-31",
    status: "draft",
    confidence: 0.87,
    source_document_id: 9,
    source_filename: "invoice.pdf",
    obligation_id: null,
    obligation_name: null,
    obligation_currency: null,
  },
  {
    id: 2,
    issuer: "Beta AS",
    invoice_number: null,
    amount: 40,
    currency: "EUR",
    issue_date: null,
    due_date: null,
    status: "confirmed",
    confidence: null,
    source_document_id: 10,
    source_filename: "scan.png",
    obligation_id: 7,
    obligation_name: "Beta AS",
    obligation_currency: "EUR",
  },
];

describe("FinanceInbox", () => {
  it("list renders invoices", () => {
    render(
      <FinanceInbox invoices={SAMPLE} loading={false} error={null} />
    );
    expect(screen.getByTestId("finance-inbox-list")).toBeTruthy();
    expect(screen.getAllByTestId("finance-inbox-item")).toHaveLength(2);
    expect(screen.getByText("ACME OÜ")).toBeTruthy();
    expect(screen.getByText("Due 2026-07-31")).toBeTruthy();
    expect(screen.getByText("No due date")).toBeTruthy();
    expect(screen.getByText("invoice.pdf")).toBeTruthy();
    expect(screen.getByText("87% confidence")).toBeTruthy();
    expect(screen.getByText("draft")).toBeTruthy();
    expect(screen.getByText("Obligation: Beta AS · EUR")).toBeTruthy();
  });

  it("empty state renders correctly", () => {
    render(<FinanceInbox invoices={[]} loading={false} error={null} />);
    expect(screen.getByTestId("finance-inbox-empty")).toBeTruthy();
    expect(screen.getByText("No documents yet")).toBeTruthy();
  });

  it("error state renders correctly", () => {
    render(
      <FinanceInbox
        invoices={[]}
        loading={false}
        error="Failed to load invoices"
      />
    );
    expect(screen.getByTestId("finance-inbox-error")).toBeTruthy();
    expect(screen.getByText("Failed to load invoices")).toBeTruthy();
  });

  it("confirm action updates invoice", async () => {
    const user = userEvent.setup();
    const onConfirmInvoice = vi.fn(async () => ({
      ...SAMPLE[0],
      status: "confirmed" as const,
      obligation_id: 42,
      obligation_name: "ACME OÜ",
      obligation_currency: "EUR",
    }));

    render(
      <FinanceInbox
        invoices={[SAMPLE[0]]}
        loading={false}
        error={null}
        onConfirmInvoice={onConfirmInvoice}
      />
    );

    await user.click(screen.getByTestId("finance-inbox-confirm-1"));
    await waitFor(() => {
      expect(screen.getByText("confirmed")).toBeTruthy();
      expect(screen.getByText("Obligation: ACME OÜ · EUR")).toBeTruthy();
    });
    expect(onConfirmInvoice).toHaveBeenCalledWith(1);
    expect(screen.queryByTestId("finance-inbox-confirm-1")).toBeNull();
  });

  it("loading state while confirming", async () => {
    const user = userEvent.setup();
    let resolveConfirm: (value: FinanceInvoice) => void = () => undefined;
    const pending = new Promise<FinanceInvoice>((resolve) => {
      resolveConfirm = resolve;
    });
    const onConfirmInvoice = vi.fn(() => pending);

    render(
      <FinanceInbox
        invoices={[SAMPLE[0]]}
        loading={false}
        error={null}
        onConfirmInvoice={onConfirmInvoice}
      />
    );

    await user.click(screen.getByTestId("finance-inbox-confirm-1"));
    expect(screen.getByTestId("finance-inbox-confirm-loading")).toBeTruthy();
    expect(screen.getByText("Confirming…")).toBeTruthy();

    resolveConfirm({
      ...SAMPLE[0],
      status: "confirmed",
      obligation_id: 3,
      obligation_name: "ACME OÜ",
      obligation_currency: "EUR",
    });
    await waitFor(() => {
      expect(screen.queryByTestId("finance-inbox-confirm-loading")).toBeNull();
    });
  });

  it("error state on confirm failure", async () => {
    const user = userEvent.setup();
    const onConfirmInvoice = vi.fn(async () => {
      throw new Error("Cannot confirm: due_date is required");
    });

    render(
      <FinanceInbox
        invoices={[SAMPLE[0]]}
        loading={false}
        error={null}
        onConfirmInvoice={onConfirmInvoice}
      />
    );

    await user.click(screen.getByTestId("finance-inbox-confirm-1"));
    await waitFor(() => {
      expect(screen.getByTestId("finance-inbox-action-error")).toBeTruthy();
      expect(
        screen.getByText("Cannot confirm: due_date is required")
      ).toBeTruthy();
    });
    // List still present
    expect(screen.getByTestId("finance-inbox-list")).toBeTruthy();
    expect(screen.getByText("draft")).toBeTruthy();
  });
});
