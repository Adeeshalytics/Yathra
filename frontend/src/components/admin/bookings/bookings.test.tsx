import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CONFIRMED_BOOKING } from "@/components/booking/fixtures";
import { BOOKING_ROW } from "@/components/admin/reports/fixtures";

const bookings = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  cancellation: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock("@/lib/api/admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/admin")>();
  return { ...actual, adminApi: { ...actual.adminApi, bookings } };
});

import { AdminBookingDetail } from "./booking-detail";
import { BookingsList } from "./bookings-list";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const PAGE = { count: 1, page: 1, total_pages: 1, next: null, previous: null, results: [BOOKING_ROW] };

describe("Admin bookings list", () => {
  beforeEach(() => {
    Object.values(bookings).forEach((fn) => fn.mockReset());
    bookings.list.mockResolvedValue(PAGE);
  });

  it("shows the reference, customer, route, seats, amount and both statuses", async () => {
    render(<BookingsList />, { wrapper });

    expect(await screen.findByRole("link", { name: "YTABC23456" })).toHaveAttribute(
      "href",
      "/admin/bookings/booking-1",
    );
    const table = screen.getByRole("table", { name: "Bookings" });
    expect(within(table).getByText("Kasuni Fernando")).toBeInTheDocument();
    expect(within(table).getByText("Colombo – Batticaloa")).toBeInTheDocument();
    expect(within(table).getByText("TR7KQ2M9")).toBeInTheDocument();
    expect(within(table).getByText("2")).toBeInTheDocument();
    expect(within(table).getByText("LKR 5,150")).toBeInTheDocument();
    expect(within(table).getByText("successful")).toBeInTheDocument();
    expect(within(table).getByText("Confirmed")).toBeInTheDocument();
    expect(bookings.list).toHaveBeenCalledWith({ page: 1 }, expect.anything());
  });

  it("searches and filters on the server, never in the browser", async () => {
    const user = userEvent.setup();
    render(<BookingsList />, { wrapper });
    await screen.findByRole("table", { name: "Bookings" });

    await user.type(screen.getByLabelText("Search bookings"), "YTABC");
    await user.click(screen.getByRole("combobox", { name: "Status" }));
    await user.click(await screen.findByRole("option", { name: "Cancelled" }));

    expect(bookings.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "cancelled" }),
      expect.anything(),
    );
    const [params] = bookings.list.mock.calls.at(-1) as [Record<string, unknown>];
    expect(params.page).toBe(1);
  });

  it("filters by the day people travel", async () => {
    const user = userEvent.setup();
    render(<BookingsList />, { wrapper });
    await screen.findByRole("table", { name: "Bookings" });

    await user.type(screen.getByLabelText("Travelling from"), "2030-09-15");

    expect(bookings.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ departure_from: "2030-09-15" }),
      expect.anything(),
    );
  });
});

describe("Admin booking detail", () => {
  beforeEach(() => {
    Object.values(bookings).forEach((fn) => fn.mockReset());
  });

  it("shows the passengers, the points, the payment and the e-ticket", async () => {
    bookings.get.mockResolvedValue(CONFIRMED_BOOKING);
    render(<AdminBookingDetail id="booking-1" />, { wrapper });

    expect(await screen.findByRole("heading", { name: "YTABC23456" })).toBeInTheDocument();
    expect(screen.getByText(/^Colombo Fort · /)).toBeInTheDocument();
    expect(screen.getByText(/^Batticaloa · /)).toBeInTheDocument();
    expect(screen.getByText("TKZB6WDYRJRZ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "E-ticket" })).toBeInTheDocument();

    const passengers = screen.getByRole("table", { name: "Passengers on YTABC23456" });
    expect(within(passengers).getByText("Dilan Fernando")).toBeInTheDocument();
    expect(within(passengers).getAllByRole("row")).toHaveLength(3); // header + two seats
  });

  it("cancels a booking for the customer, showing the server's refund quote", async () => {
    const user = userEvent.setup();
    bookings.get.mockResolvedValue(CONFIRMED_BOOKING);
    bookings.cancellation.mockResolvedValue({
      ...CONFIRMED_BOOKING.cancellation,
      rules: ["48 hours or more before departure: in full"],
    });
    bookings.cancel.mockResolvedValue({
      ...CONFIRMED_BOOKING,
      status: "cancelled",
      refunds: [
        {
          id: "refund-1",
          reference: "RF123",
          status: "requested",
          status_label: "Requested",
          amount: "5150.00",
          currency: "LKR",
          reason: "",
          created_at: "2030-09-10T11:00:00+05:30",
        },
      ],
    });
    render(<AdminBookingDetail id="booking-1" />, { wrapper });

    await user.click(await screen.findByRole("button", { name: "Cancel booking" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Customer paid")).toBeInTheDocument();
    expect(within(dialog).getByText("Refund (100%)")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/Reason/), "Customer rang the office");
    await user.click(within(dialog).getByRole("button", { name: "Cancel booking" }));

    expect(bookings.cancel).toHaveBeenCalledWith("booking-1", "Customer rang the office");
  });

  it("offers no cancel button when the policy refuses it", async () => {
    bookings.get.mockResolvedValue({
      ...CONFIRMED_BOOKING,
      status: "cancelled",
      status_label: "Cancelled",
      cancellation: {
        ...CONFIRMED_BOOKING.cancellation,
        allowed: false,
        code: "already_cancelled",
        message: "This booking has already been cancelled.",
      },
    });
    render(<AdminBookingDetail id="booking-1" />, { wrapper });

    await screen.findByRole("heading", { name: "YTABC23456" });
    expect(screen.queryByRole("button", { name: "Cancel booking" })).not.toBeInTheDocument();
  });
});
