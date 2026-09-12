import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BOOKING, CONFIRMED_BOOKING, PAYMENT } from "./fixtures";
import { PaymentStatusView } from "./payment-status-view";

const api = vi.hoisted(() => ({ get: vi.fn() }));
const payments = vi.hoisted(() => ({ get: vi.fn(), verify: vi.fn(), cancel: vi.fn() }));

vi.mock("@/lib/api/endpoints", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/endpoints")>()),
  bookingsApi: api,
  paymentsApi: payments,
}));

function renderView(props: { paymentId?: string | null; cancelled?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PaymentStatusView
        bookingId="booking-1"
        paymentId={props.paymentId === undefined ? PAYMENT.id : props.paymentId}
        cancelled={props.cancelled}
      />
    </QueryClientProvider>,
  );
}

describe("PaymentStatusView", () => {
  beforeEach(() => {
    [api.get, payments.get, payments.verify, payments.cancel].forEach((fn) => fn.mockReset());
    api.get.mockResolvedValue(BOOKING);
  });

  it("waits for the gateway's confirmation instead of trusting the redirect", async () => {
    payments.get.mockResolvedValue(PAYMENT);
    renderView();

    expect(await screen.findByRole("heading", { name: "Confirming your payment…" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/please don’t pay again/);
    expect(screen.queryByRole("link", { name: "View e-ticket" })).not.toBeInTheDocument();
  });

  it("celebrates a verified payment and links to the ticket", async () => {
    api.get.mockResolvedValue(CONFIRMED_BOOKING);
    payments.get.mockResolvedValue({
      ...PAYMENT,
      status: "successful",
      status_label: "Successful",
      booking_status: "confirmed",
      payment_method_label: "Card",
    });
    renderView();

    expect(await screen.findByRole("heading", { name: "Payment successful" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View e-ticket" })).toHaveAttribute("href", "/bookings/booking-1/ticket");
    expect(screen.getByText("TXN0123456789ABCDEF01")).toBeInTheDocument();
  });

  it("explains a declined payment and offers a retry while seats are held", async () => {
    payments.get.mockResolvedValue({ ...PAYMENT, status: "failed", failure_reason: "Do not honour" });
    renderView();

    expect(await screen.findByRole("heading", { name: "Payment didn’t go through" })).toBeInTheDocument();
    expect(screen.getByText("Do not honour")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Try again" })).toHaveAttribute(
      "href",
      "/bookings/booking-1/checkout",
    );
  });

  it("tells the server when the customer cancelled on the gateway's page", async () => {
    payments.get.mockResolvedValue(PAYMENT);
    payments.cancel.mockResolvedValue({ ...PAYMENT, status: "cancelled", status_label: "Cancelled" });
    renderView({ cancelled: true });

    expect(await screen.findByRole("heading", { name: "Payment cancelled" })).toBeInTheDocument();
    expect(payments.cancel).toHaveBeenCalledTimes(1);
    expect(payments.cancel).toHaveBeenCalledWith(PAYMENT.id);
    expect(screen.getByText("You cancelled the payment. No money was taken.")).toBeInTheDocument();
  });

  it("promises a refund when the payment couldn't be used", async () => {
    payments.get.mockResolvedValue({
      ...PAYMENT,
      status: "successful",
      booking_status: "expired",
      requires_refund: true,
      failure_reason: "The payment arrived after the seat hold ran out and the seats were gone.",
    });
    renderView();

    expect(await screen.findByRole("heading", { name: /We received your payment/ })).toBeInTheDocument();
    expect(screen.getByText(/We’ll refund LKR 5,150/)).toBeInTheDocument();
  });

  it("handles a missing or malformed payment id", async () => {
    renderView({ paymentId: "not-a-uuid" });

    expect(await screen.findByText("We couldn’t find this payment")).toBeInTheDocument();
    expect(payments.get).not.toHaveBeenCalled();
  });
});
