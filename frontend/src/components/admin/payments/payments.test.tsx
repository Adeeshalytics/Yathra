import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PAYMENT } from "@/components/booking/fixtures";
import type { AdminPaymentDetail } from "@/lib/api/payment-types";

import { PaymentDetail } from "./payment-detail";
import { PaymentsList } from "./payments-list";

const payments = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  summary: vi.fn(),
  refund: vi.fn(),
  reconcile: vi.fn(),
}));

vi.mock("@/lib/api/admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/admin")>();
  return { ...actual, adminApi: { ...actual.adminApi, payments } };
});

const DETAIL: AdminPaymentDetail = {
  ...PAYMENT,
  status: "successful",
  status_label: "Successful",
  booking_status: "confirmed",
  payment_method: "card",
  payment_method_label: "Card",
  paid_at: "2030-09-10T10:03:00+05:30",
  provider_reference: "MOCK1A2B3C",
  customer: { id: "user-1", name: "Kasuni Fernando", email: "kasuni@example.com" },
  trip: { id: "trip-1", code: "TR7KQ2M9", route: "Colombo – Batticaloa", departure_datetime: "2030-09-15T20:30:00+05:30" },
  refundable_amount: "5150.00",
  refund_through_gateway: true,
  expires_at: "2030-09-10T10:12:00+05:30",
  updated_at: "2030-09-10T10:03:00+05:30",
  provider_data: {},
  booking_detail: {
    id: "booking-1",
    booking_reference: "YTABC23456",
    status: "confirmed",
    status_label: "Confirmed",
    total_amount: "5150.00",
    currency: "LKR",
    seats: ["15", "16"],
  },
  events: [
    {
      id: 1,
      source: "checkout",
      source_label: "Checkout started",
      event_id: "checkout:1",
      status: "pending",
      outcome: "applied",
      outcome_label: "Applied",
      message: "Checkout started with Test card payment.",
      data: {},
      created_at: "2030-09-10T10:02:00+05:30",
    },
    {
      id: 2,
      source: "webhook",
      source_label: "Gateway notification",
      event_id: "evt_1",
      status: "successful",
      outcome: "applied",
      outcome_label: "Applied",
      message: "",
      data: { payment_id: "MOCK1A2B3C", method: "card" },
      created_at: "2030-09-10T10:03:00+05:30",
    },
  ],
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("Admin payments", () => {
  beforeEach(() => {
    Object.values(payments).forEach((fn) => fn.mockReset());
  });

  it("lists payments with their references, amounts and status", async () => {
    payments.list.mockResolvedValue({
      count: 2,
      total_pages: 1,
      results: [DETAIL, { ...DETAIL, id: "p2", transaction_reference: "TXNNEEDSREFUND", requires_refund: true }],
    });
    payments.summary.mockResolvedValue({
      currency: "LKR",
      collected_today: "5150.00",
      collected_30_days: "10300.00",
      refunded_total: "0.00",
      needs_refund: 1,
      open: 0,
      by_status: {},
    });
    render(<PaymentsList />, { wrapper });

    expect(await screen.findByRole("link", { name: PAYMENT.transaction_reference })).toHaveAttribute(
      "href",
      `/admin/payments/${PAYMENT.id}`,
    );
    const table = screen.getByRole("table", { name: "Payments" });
    expect(within(table).getAllByText("YTABC23456")).toHaveLength(2);
    expect(within(table).getAllByText("LKR 5,150")).toHaveLength(2);
    expect(within(table).getByText("Needs refund")).toBeInTheDocument();
    expect(await screen.findByText("Collected today")).toBeInTheDocument();
    expect(screen.getByText("LKR 10,300")).toBeInTheDocument();
    expect(payments.list).toHaveBeenCalledWith({ page: 1 }, expect.anything());
  });

  it("shows a payment's timeline and refunds it through the gateway", async () => {
    const user = userEvent.setup();
    payments.get.mockResolvedValue(DETAIL);
    payments.refund.mockResolvedValue({ ...DETAIL, status: "refunded", status_label: "Refunded" });
    render(<PaymentDetail id={PAYMENT.id} />, { wrapper });

    expect(await screen.findByRole("heading", { name: PAYMENT.transaction_reference })).toBeInTheDocument();
    expect(screen.getByText("Gateway notification")).toBeInTheDocument();
    expect(screen.getByText("payment_id:")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Refund" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/A full refund cancels booking YTABC23456/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Amount (LKR)")).toHaveValue(5150);
    await user.type(within(dialog).getByLabelText(/Reason/), "Customer couldn’t travel");
    await user.click(within(dialog).getByRole("button", { name: /Refund LKR\s*5,150/ }));

    expect(payments.refund).toHaveBeenCalledWith(PAYMENT.id, {
      amount: "5150.00",
      reason: "Customer couldn’t travel",
      external: false,
    });
  });

  it("records refunds made in the gateway's portal when it has no refund API", async () => {
    const user = userEvent.setup();
    payments.get.mockResolvedValue({ ...DETAIL, provider: "payhere", provider_name: "PayHere", refund_through_gateway: false });
    payments.refund.mockResolvedValue(DETAIL);
    render(<PaymentDetail id={PAYMENT.id} />, { wrapper });

    await user.click(await screen.findByRole("button", { name: "Refund" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/PayHere refunds are made in its merchant portal/)).toBeInTheDocument();
    const amount = within(dialog).getByLabelText("Amount (LKR)");
    await user.clear(amount);
    await user.type(amount, "1000");
    await user.click(within(dialog).getByRole("button", { name: /Refund LKR\s*1,000/ }));

    expect(payments.refund).toHaveBeenCalledWith(PAYMENT.id, { amount: "1000", reason: "", external: true });
  });

  it("refuses refunds above what's left", async () => {
    const user = userEvent.setup();
    payments.get.mockResolvedValue(DETAIL);
    render(<PaymentDetail id={PAYMENT.id} />, { wrapper });

    await user.click(await screen.findByRole("button", { name: "Refund" }));
    const dialog = await screen.findByRole("dialog");
    const amount = within(dialog).getByLabelText("Amount (LKR)");
    await user.clear(amount);
    await user.type(amount, "9999");

    expect(within(dialog).getByText(/Enter an amount between/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Refund LKR/ })).toBeDisabled();
  });
});
