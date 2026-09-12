import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BOOKING, CONFIRMED_BOOKING } from "@/components/booking/fixtures";
import type { BookingSummary } from "@/lib/api/booking-types";

import { AccountOverview } from "./account-overview";

const api = vi.hoisted(() => ({ mine: vi.fn(), summary: vi.fn() }));
const user = vi.hoisted(() => ({
  id: "user-1",
  name: "Kasuni Fernando",
  email: "kasuni@example.com",
  phone: "+94771234567",
  role: "customer" as const,
  is_active: true,
  created_at: "2029-04-02T09:00:00+05:30",
  updated_at: "2029-04-02T09:00:00+05:30",
}));

vi.mock("@/lib/api/endpoints", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/endpoints")>()),
  bookingsApi: api,
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user, status: "authenticated" }) }));

const SUMMARY: BookingSummary = {
  upcoming: 2,
  past: 5,
  cancelled: 1,
  total: 8,
  spent: "12500.00",
  currency: "LKR",
  open_refunds: 1,
  next_departure: "2030-09-15T20:30:00+05:30",
};

function page(results: unknown[]) {
  return { count: results.length, total_pages: 1, next: null, previous: null, results };
}

function renderDashboard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AccountOverview />
    </QueryClientProvider>,
  );
}

describe("AccountOverview", () => {
  beforeEach(() => {
    [api.mine, api.summary].forEach((fn) => fn.mockReset());
    api.summary.mockResolvedValue(SUMMARY);
    api.mine.mockResolvedValue(page([CONFIRMED_BOOKING]));
  });

  it("greets the customer and shows their profile and totals", async () => {
    renderDashboard();

    expect(await screen.findByRole("heading", { name: "Ayubowan, Kasuni!" })).toBeInTheDocument();
    expect(screen.getByText("kasuni@example.com")).toBeInTheDocument();
    expect(screen.getByText("+94771234567")).toBeInTheDocument();

    const stats = within(await screen.findByRole("group", { name: "Booking summary" }));
    expect(stats.getByText("Upcoming trips").nextElementSibling).toHaveTextContent("2");
    expect(stats.getByText("Previous trips").nextElementSibling).toHaveTextContent("5");
    expect(stats.getByText("Cancelled").nextElementSibling).toHaveTextContent("1");
    expect(stats.getByText("Total paid").nextElementSibling).toHaveTextContent("LKR 12,500");
    expect(stats.getByText("1 refund on the way")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Edit/ })).toHaveAttribute("href", "/account/profile");
  });

  it("lists a booking with everything needed to recognise it", async () => {
    renderDashboard();

    // Phones get cards and wider screens the table; jsdom renders both, so scope to the table.
    await screen.findAllByRole("link", { name: "YTABC23456" });
    const table = within(screen.getByRole("table", { name: /bookings/i }));
    expect(table.getByRole("link", { name: "YTABC23456" })).toHaveAttribute(
      "href",
      "/bookings/booking-1",
    );
    expect(table.getByText("Colombo Fort → Batticaloa")).toBeInTheDocument();
    expect(table.getByText("15, 16")).toBeInTheDocument();
    expect(table.getByText("Confirmed")).toBeInTheDocument();
    expect(table.getByText("LKR 5,150")).toBeInTheDocument();
    // A paid booking offers its ticket first.
    expect(table.getByRole("link", { name: /E-ticket/ })).toHaveAttribute(
      "href",
      "/bookings/booking-1/ticket",
    );
    expect(api.mine).toHaveBeenCalledWith({ page: 1, scope: "upcoming" }, expect.anything());
  });

  it("offers to pay for a booking that is still waiting", async () => {
    api.mine.mockResolvedValue(page([BOOKING]));
    renderDashboard();

    const [pay] = await screen.findAllByRole("link", { name: "Pay now" });
    expect(pay).toHaveAttribute("href", "/bookings/booking-1/checkout");
  });

  it("switches between upcoming, previous, cancelled and the whole history", async () => {
    const person = userEvent.setup();
    renderDashboard();
    await screen.findAllByRole("link", { name: "YTABC23456" });

    await person.click(screen.getByRole("tab", { name: "Previous trips" }));
    expect(api.mine).toHaveBeenLastCalledWith({ page: 1, scope: "past" }, expect.anything());

    await person.click(screen.getByRole("tab", { name: "Cancelled" }));
    expect(api.mine).toHaveBeenLastCalledWith({ page: 1, scope: "cancelled" }, expect.anything());

    await person.click(screen.getByRole("tab", { name: "Booking history" }));
    expect(api.mine).toHaveBeenLastCalledWith({ page: 1 }, expect.anything());
  });

  it("says so when a tab is empty", async () => {
    api.mine.mockResolvedValue(page([]));
    renderDashboard();

    expect((await screen.findAllByText("No trips coming up"))[0]).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Find a bus" })[0]).toHaveAttribute("href", "/#search");
  });
});
