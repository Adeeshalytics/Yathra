import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CheckoutView } from "./checkout-view";
import { BOOKING, CONFIRMED_BOOKING, PAYMENT } from "./fixtures";

const api = vi.hoisted(() => ({ get: vi.fn() }));
const payments = vi.hoisted(() => ({ providers: vi.fn(), start: vi.fn() }));
const navigation = vi.hoisted(() => ({ push: vi.fn() }));
const gateway = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("@/lib/api/endpoints", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/endpoints")>()),
  bookingsApi: api,
  paymentsApi: payments,
}));
vi.mock("@/lib/payment", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payment")>()),
  goToCheckout: gateway,
}));

const PROVIDERS = {
  default: "mock",
  providers: [
    { code: "mock", name: "Test card payment", description: "Simulated payment", test_mode: true },
    { code: "payhere", name: "PayHere", description: "Visa, Mastercard, eZ Cash…", test_mode: false },
  ],
};

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CheckoutView id="booking-1" />
    </QueryClientProvider>,
  );
}

describe("CheckoutView", () => {
  beforeEach(() => {
    [api.get, payments.providers, payments.start, navigation.push, gateway].forEach((fn) => fn.mockReset());
    payments.providers.mockResolvedValue(PROVIDERS);
  });

  it("summarises the trip, passengers and the server's price", async () => {
    api.get.mockResolvedValue(BOOKING);
    renderView();

    expect(await screen.findByRole("heading", { name: "Payment" })).toBeInTheDocument();
    expect(screen.getByText("Colombo → Batticaloa")).toBeInTheDocument();
    expect(screen.getByText("Boarding point").nextElementSibling).toHaveTextContent("Colombo Fort");
    expect(screen.getByText("Drop-off point").nextElementSibling).toHaveTextContent("Batticaloa");
    expect(screen.getByText("Dilan Fernando")).toBeInTheDocument();
    expect(screen.getByText("Seats 15, 16")).toBeInTheDocument();
    expect(screen.getByText("Ticket price").closest("div")).toHaveTextContent("LKR 5,000");
    expect(screen.getByText("Fees").closest("div")).toHaveTextContent("LKR 150");
    expect(screen.getByText("Total").closest("div")).toHaveTextContent("LKR 5,150");
    expect(screen.getByRole("timer")).toBeInTheDocument();
  });

  it("starts the payment with the chosen gateway and hands over to it", async () => {
    const user = userEvent.setup();
    const checkout = { method: "post", url: "https://sandbox.payhere.lk/pay/checkout", fields: { hash: "X" } };
    api.get.mockResolvedValue(BOOKING);
    payments.start.mockResolvedValue({ payment: { ...PAYMENT, provider: "payhere" }, checkout });
    renderView();

    const methods = await screen.findByRole("group", { name: "Pay with" });
    expect(within(methods).getByRole("radio", { name: /Test card payment/ })).toBeChecked();
    await user.click(within(methods).getByRole("radio", { name: /PayHere/ }));
    await user.click(screen.getByRole("button", { name: /Pay Now/ }));

    expect(payments.start).toHaveBeenCalledWith("booking-1", "payhere");
    expect(gateway).toHaveBeenCalledWith(checkout);
    expect(await screen.findByRole("button", { name: /Taking you to PayHere/ })).toBeDisabled();
  });

  it("goes straight to the ticket when there is nothing to pay", async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue(BOOKING);
    payments.start.mockResolvedValue({ payment: null, checkout: { method: "none", url: "", fields: {} } });
    renderView();

    await user.click(await screen.findByRole("button", { name: /Pay Now/ }));

    expect(navigation.push).toHaveBeenCalledWith("/bookings/booking-1/ticket");
    expect(gateway).not.toHaveBeenCalled();
  });

  it("explains a failed last attempt", async () => {
    api.get.mockResolvedValue({
      ...BOOKING,
      payment: {
        id: PAYMENT.id,
        status: "failed",
        status_label: "Failed",
        provider: "mock",
        failure_reason: "Insufficient funds",
        requires_refund: false,
        created_at: PAYMENT.created_at,
      },
    });
    renderView();

    expect(await screen.findByText(/Your last payment didn’t go through: Insufficient funds/)).toBeInTheDocument();
  });

  it("sends paid bookings to their ticket and expired ones back to the seat map", async () => {
    api.get.mockResolvedValueOnce(CONFIRMED_BOOKING);
    renderView();
    expect(await screen.findByRole("link", { name: "View e-ticket" })).toHaveAttribute(
      "href",
      "/bookings/booking-1/ticket",
    );
  });

  it("offers to choose seats again when the hold has run out", async () => {
    api.get.mockResolvedValue({ ...BOOKING, status: "expired", status_label: "Expired", seconds_remaining: null });
    renderView();

    expect(await screen.findByRole("link", { name: "Choose seats again" })).toHaveAttribute("href", "/trips/trip-1");
    expect(screen.queryByRole("button", { name: /Pay Now/ })).not.toBeInTheDocument();
  });
});
