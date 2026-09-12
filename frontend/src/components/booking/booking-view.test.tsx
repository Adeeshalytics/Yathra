import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CustomerBooking } from "@/lib/api/booking-types";

import { BookingView } from "./booking-view";
import { CANCELLATION } from "./fixtures";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  checkout: vi.fn(),
  cancel: vi.fn(),
  updatePassengers: vi.fn(),
}));
const navigation = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => navigation }));

vi.mock("@/lib/api/endpoints", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/endpoints")>()),
  bookingsApi: api,
}));

const stop = (id: string, name: string, city = name) => ({ id, name, city });

const BOOKING: CustomerBooking = {
  id: "booking-1",
  booking_reference: "YTABC23456",
  status: "pending",
  status_label: "Pending",
  customer: { id: "user-1", name: "Kasuni Fernando", email: "kasuni@example.com" },
  trip: {
    id: "trip-1",
    code: "TR7KQ2M9",
    status: "scheduled",
    route: {
      id: "route-1",
      name: "Colombo – Batticaloa",
      route_number: "",
      origin: stop("a", "Colombo Fort", "Colombo"),
      destination: stop("e", "Batticaloa"),
    },
    operator: { id: "operator-1", name: "Ceylon Coach Services" },
    bus: {
      name: "Batticaloa Night Express",
      registration_number: "WP NC-4521",
      bus_type: "super_luxury",
      bus_type_label: "Super Luxury",
    },
    departure_datetime: "2030-09-15T20:30:00+05:30",
    arrival_datetime: "2030-09-16T05:30:00+05:30",
  },
  boarding: { stop: stop("a", "Colombo Fort", "Colombo"), time: "2030-09-15T20:30:00+05:30" },
  dropoff: { stop: stop("e", "Batticaloa"), time: "2030-09-16T05:30:00+05:30" },
  seats: ["15", "16"],
  passengers: [
    { id: "p1", seat_number: "15", name: "Kasuni Fernando", phone: "+94771234567", email: "kasuni@example.com" },
    { id: "p2", seat_number: "16", name: "Dilan Fernando", phone: "+94771234568", email: "dilan@example.com" },
  ],
  price: {
    currency: "LKR",
    unit_price: "2500.00",
    seats: 2,
    subtotal: "5000.00",
    service_fee: "0.00",
    discount: "0.00",
    tax: "0.00",
    total: "5000.00",
  },
  total_amount: "5000.00",
  currency: "LKR",
  expires_at: "2030-09-10T10:05:00+05:30",
  seconds_remaining: 240,
  ticket: null,
  payment: null,
  cancellation: CANCELLATION,
  refunds: [],
  confirmed_at: null,
  cancelled_at: null,
  cancellation_reason: "",
  created_at: "2030-09-10T10:00:00+05:30",
  updated_at: "2030-09-10T10:00:00+05:30",
};

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <BookingView id="booking-1" />
    </QueryClientProvider>,
  );
}

describe("BookingView", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    navigation.push.mockReset();
  });

  it("reviews a pending booking with its countdown and server price", async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue(BOOKING);
    api.checkout.mockResolvedValue({ ...BOOKING, status: "payment_pending", status_label: "Payment pending" });
    renderView();

    expect(await screen.findByRole("heading", { name: "Review your booking" })).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent(/[34]:\d\d/);
    expect(screen.getByText("Kasuni Fernando")).toBeInTheDocument();
    expect(screen.getByText("Seat 16")).toBeInTheDocument();
    // Subtotal and total are both LKR 5,000 here; check the total row itself.
    expect(screen.getByText("Total").closest("div")).toHaveTextContent(/Total\s*LKR\s5,000/);

    await user.click(screen.getByRole("button", { name: "Confirm and continue to payment" }));

    expect(api.checkout).toHaveBeenCalledWith("booking-1");
    expect(navigation.push).toHaveBeenCalledWith("/bookings/booking-1/checkout");
    expect(await screen.findByRole("link", { name: "Continue to payment" })).toHaveAttribute(
      "href",
      "/bookings/booking-1/checkout",
    );
    expect(screen.getByText("Payment pending")).toBeInTheDocument();
  });

  it("promises a refund for a payment that couldn't be used", async () => {
    api.get.mockResolvedValue({
      ...BOOKING,
      status: "expired",
      status_label: "Expired",
      seconds_remaining: null,
      payment: {
        id: "pay-1",
        status: "successful",
        status_label: "Successful",
        provider: "mock",
        failure_reason: "The payment arrived after the seat hold ran out and the seats were gone.",
        requires_refund: true,
        created_at: "2030-09-10T10:04:00+05:30",
      },
    });
    renderView();

    expect(await screen.findByText(/It will be refunded to you in full/)).toBeInTheDocument();
  });

  it("sends customers back to the seat map when the hold ran out", async () => {
    api.get.mockResolvedValue({
      ...BOOKING,
      status: "expired",
      status_label: "Expired",
      seconds_remaining: null,
      // The server refuses to cancel what has already lapsed, so no button is offered.
      cancellation: {
        ...CANCELLATION,
        allowed: false,
        code: "expired",
        message: "This booking expired, so there is nothing to cancel.",
      },
    });
    renderView();

    expect(await screen.findByRole("link", { name: "Choose seats again" })).toHaveAttribute("href", "/trips/trip-1");
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel booking" })).not.toBeInTheDocument();
  });

  it("celebrates a confirmed booking and links to its e-ticket", async () => {
    api.get.mockResolvedValue({
      ...BOOKING,
      status: "confirmed",
      status_label: "Confirmed",
      seconds_remaining: null,
      ticket: { ticket_number: "TKZB6WDYRJRZ", status: "valid", issued_at: "2030-09-10T10:03:00+05:30" },
    });
    renderView();

    expect(await screen.findByText(/Your booking is confirmed/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View e-ticket" })).toHaveAttribute("href", "/bookings/booking-1/ticket");
    expect(screen.queryByRole("button", { name: "Confirm and continue to payment" })).not.toBeInTheDocument();
  });
});
