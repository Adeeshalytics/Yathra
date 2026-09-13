import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  OperatorBookingDetail,
  OperatorDashboard as Dashboard,
  OperatorTripRow,
} from "@/lib/api/portal-types";
import type { OperatorProfile } from "@/lib/api/types";

const operator = vi.hoisted(() => ({
  profile: vi.fn(),
  dashboard: vi.fn(),
  trips: { list: vi.fn(), get: vi.fn(), manifest: vi.fn(), manifestPdf: vi.fn() },
  bookings: { list: vi.fn(), get: vi.fn() },
  reports: { run: vi.fn(), download: vi.fn() },
}));

vi.mock("@/lib/api/endpoints", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/endpoints")>();
  return { ...actual, operatorApi: operator };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/operator",
  useSearchParams: () => new URLSearchParams(),
}));

import { OperatorBookingDetail as BookingDetail } from "./operator-booking-detail";
import { OperatorDashboard } from "./operator-dashboard";
import { OperatorGate } from "./operator-gate";
import { OperatorRevenue } from "./operator-revenue";
import { OperatorTrips } from "./operator-trips";

const COMPANY = {
  id: "operator-1",
  company_name: "Ceylon Coach Services",
  registration_number: "PV-00001",
  contact_phone: "+94112345678",
  contact_email: "ops@ceyloncoach.lk",
  address: "1 Main Street, Colombo",
  status: "active" as const,
  created_at: "2030-01-01T09:00:00+05:30",
  updated_at: "2030-01-01T09:00:00+05:30",
};

function profile(role: OperatorProfile["role"], status = "active"): OperatorProfile {
  return { role, operator: { ...COMPANY, status } } as OperatorProfile;
}

const TRIP: OperatorTripRow = {
  id: "trip-1",
  code: "TR7KQ2M9",
  status: "scheduled",
  status_label: "Scheduled",
  route_name: "Colombo – Kandy",
  origin: "Colombo",
  destination: "Kandy",
  departure_datetime: "2030-09-15T20:30:00+05:30",
  arrival_datetime: "2030-09-15T23:30:00+05:30",
  bus_registration: "WP NC-4521",
  bus_name: "Hill Country Express",
  seats_sold: 30,
  capacity: 41,
  occupancy: 73.2,
  boarded: 4,
};

const SUMMARY = {
  gross_revenue: "80000.00",
  refunds: "5000.00",
  net_revenue: "75000.00",
  bookings: 30,
  payments: 30,
  average_booking_value: "2500.00",
};

function dashboard(overrides: Partial<Dashboard> = {}): Dashboard {
  return {
    operator: { id: "operator-1", company_name: "Ceylon Coach Services", status: "active" },
    role: "owner",
    can_see_revenue: true,
    today: {
      date: "2030-09-15",
      trips: 3,
      cancelled_trips: 1,
      capacity: 82,
      passengers: 60,
      boarded: 12,
      occupancy: 73.2,
      bookings_sold: 9,
      seats_sold: 14,
    },
    upcoming: { next_7_days: 12, trips: [TRIP] },
    revenue: { today: { ...SUMMARY, net_revenue: "12500.00" }, month: SUMMARY },
    ...overrides,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function reset() {
  operator.profile.mockReset();
  operator.dashboard.mockReset();
  Object.values(operator.trips).forEach((fn) => fn.mockReset());
  Object.values(operator.bookings).forEach((fn) => fn.mockReset());
  Object.values(operator.reports).forEach((fn) => fn.mockReset());
}

describe("OperatorGate", () => {
  beforeEach(reset);

  it("shows the portal to an approved company", async () => {
    operator.profile.mockResolvedValue(profile("staff"));
    render(<OperatorGate>portal content</OperatorGate>, { wrapper });

    expect(await screen.findByText("portal content")).toBeInTheDocument();
  });

  it("explains that a company is waiting for approval instead", async () => {
    operator.profile.mockResolvedValue(profile("owner", "pending"));
    render(<OperatorGate>portal content</OperatorGate>, { wrapper });

    expect(await screen.findByText("Awaiting approval")).toBeInTheDocument();
    expect(screen.queryByText("portal content")).not.toBeInTheDocument();
    expect(screen.getByText("PV-00001")).toBeInTheDocument();
  });
});

describe("OperatorDashboard", () => {
  beforeEach(reset);

  it("shows today, the next departures and the takings to an owner", async () => {
    operator.dashboard.mockResolvedValue(dashboard());
    render(<OperatorDashboard />, { wrapper });

    expect(await screen.findByText("Next departures")).toBeInTheDocument();
    expect(screen.getByText("1 cancelled")).toBeInTheDocument();
    expect(screen.getByText("12 boarded · 73.2% of seats")).toBeInTheDocument();
    expect(screen.getByText("Takings today")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Colombo → Kandy" })).toHaveAttribute("href", "/operator/trips/trip-1");
    expect(screen.getByRole("link", { name: /Manifest/ })).toHaveAttribute("href", "/operator/trips/trip-1/manifest");
    expect(screen.getByText("This month")).toBeInTheDocument();
  });

  it("leaves the money out for staff", async () => {
    operator.dashboard.mockResolvedValue(dashboard({ role: "staff", can_see_revenue: false, revenue: null }));
    render(<OperatorDashboard />, { wrapper });

    expect(await screen.findByText("Next departures")).toBeInTheDocument();
    expect(screen.queryByText("Takings today")).not.toBeInTheDocument();
    expect(screen.queryByText("This month")).not.toBeInTheDocument();
    expect(screen.getByText("Next 7 days")).toBeInTheDocument();
  });
});

describe("OperatorTrips", () => {
  beforeEach(reset);

  it("lists upcoming trips with their seats sold", async () => {
    operator.trips.list.mockResolvedValue({ count: 1, page: 1, total_pages: 1, next: null, previous: null, results: [TRIP] });
    render(<OperatorTrips />, { wrapper });

    const row = (await screen.findByText("TR7KQ2M9")).closest("tr") as HTMLElement;
    expect(within(row).getByText("WP NC-4521")).toBeInTheDocument();
    expect(within(row).getByRole("meter", { name: "Seats sold" })).toHaveAttribute("aria-valuenow", "73");
    expect(operator.trips.list).toHaveBeenCalledWith(
      expect.objectContaining({ when: "upcoming", ordering: "departure_datetime" }),
      expect.anything(),
    );
  });
});

describe("OperatorRevenue", () => {
  beforeEach(reset);

  it("is only for owners and managers", async () => {
    operator.profile.mockResolvedValue(profile("staff"));
    render(<OperatorRevenue />, { wrapper });

    expect(await screen.findByText("Takings are for owners and managers")).toBeInTheDocument();
    expect(operator.reports.run).not.toHaveBeenCalled();
  });

  it("shows the takings by day for an owner", async () => {
    operator.profile.mockResolvedValue(profile("owner"));
    operator.reports.run.mockResolvedValue({
      key: "revenue",
      title: "Revenue report",
      range: { key: "month", label: "This month", from_date: "2030-09-01", to_date: "2030-09-15" },
      columns: [
        { key: "day", header: "Date" },
        { key: "net", header: "Net" },
      ],
      summary: SUMMARY,
      count: 1,
      page: 1,
      total_pages: 1,
      next: null,
      previous: null,
      results: [{ day: "2030-09-15", net: "75000.00" }],
    });
    render(<OperatorRevenue />, { wrapper });

    expect(await screen.findByText("Net revenue")).toBeInTheDocument();
    expect(operator.reports.run).toHaveBeenCalledWith("revenue", expect.objectContaining({ range: "month" }), expect.anything());
    // Net in the totals and in the day's row.
    expect(screen.getAllByText(/LKR\s75,000/).length).toBe(2);
  });
});

describe("OperatorBookingDetail", () => {
  beforeEach(reset);

  it("shows the passengers with numbers the crew can call", async () => {
    const booking: OperatorBookingDetail = {
      id: "booking-1",
      booking_reference: "YT7KQ2M9XH",
      status: "confirmed",
      status_label: "Confirmed",
      customer: { name: "Kasuni Fernando", phone: "+94771234567" },
      route_name: "Colombo – Kandy",
      trip: "trip-1",
      trip_code: "TR7KQ2M9",
      departure: "2030-09-15T20:30:00+05:30",
      seats: 2,
      total_amount: "5000.00",
      paid_amount: "5000.00",
      currency: "LKR",
      payment_status: "successful",
      created_at: "2030-09-10T10:00:00+05:30",
      confirmed_at: "2030-09-10T10:05:00+05:30",
      cancelled_at: null,
      cancellation_reason: "",
      trip_details: {
        id: "trip-1",
        code: "TR7KQ2M9",
        status: "scheduled",
        status_label: "Scheduled",
        route_name: "Colombo – Kandy",
        departure_datetime: "2030-09-15T20:30:00+05:30",
        bus_registration: "WP NC-4521",
      },
      boarding: { name: "Pettah Central", time: "2030-09-15T20:30:00+05:30" },
      dropoff: { name: "Kandy", time: "2030-09-15T23:30:00+05:30" },
      passengers: [
        { id: "p1", seat_number: "15", name: "Kasuni Fernando", phone: "+94771234567", boarding_status: "boarded", boarded_at: "2030-09-15T20:20:00+05:30" },
        { id: "p2", seat_number: "16", name: "Ravi Fernando", phone: "+94715550101", boarding_status: "expected", boarded_at: null },
      ],
      ticket: { ticket_number: "TK7KQ2M9XHAB", status: "valid" },
      refunds: [],
    };
    operator.bookings.get.mockResolvedValue(booking);
    render(<BookingDetail id="booking-1" />, { wrapper });

    const ravi = (await screen.findByText("Ravi Fernando")).closest("tr") as HTMLElement;
    expect(within(ravi).getByRole("link", { name: "+94715550101" })).toHaveAttribute("href", "tel:+94715550101");
    expect(within(ravi).getByText("Expected")).toBeInTheDocument();
    expect(screen.getByText("Pettah Central, 8:30 PM")).toBeInTheDocument();
    expect(screen.getByText("TK7KQ2M9XHAB")).toBeInTheDocument();
  });
});
