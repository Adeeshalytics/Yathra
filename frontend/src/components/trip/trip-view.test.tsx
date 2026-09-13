/**
 * The seat-selection page, rendered end to end with its data mocked.
 *
 * This is the page a customer spends the most time on, and it is the one screen that pulls in
 * the seat map, the boarding pickers and the route map at once — so it is worth proving it
 * mounts, in that combination, on every change.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PublicTrip, TripSeatMap, TripStopsResponse } from "@/lib/api/trip-types";

const trips = vi.hoisted(() => ({ get: vi.fn(), stops: vi.fn(), seats: vi.fn() }));
const seatLocks = vi.hoisted(() => ({ hold: vi.fn(), lock: vi.fn(), release: vi.fn(), releaseAll: vi.fn() }));
const phone = vi.hoisted(() => ({ requestPhoneCode: vi.fn(), signInWithPhone: vi.fn() }));
const page = vi.hoisted(() => ({ search: "" }));

vi.mock("@/lib/api/endpoints", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/endpoints")>();
  return {
    ...actual,
    tripsApi: { ...actual.tripsApi, ...trips },
    seatLocksApi: { ...actual.seatLocksApi, ...seatLocks },
    authApi: { ...actual.authApi, requestPhoneCode: phone.requestPhoneCode },
  };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/trips/trip-1",
  useSearchParams: () => new URLSearchParams(page.search),
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: null,
    status: "unauthenticated",
    isAuthenticated: false,
    signInWithPhone: phone.signInWithPhone,
  }),
}));

import { TripView } from "./trip-view";

const stop = (id: string, name: string, latitude: string | null, longitude: string | null) => ({
  id,
  name,
  city: name,
  latitude,
  longitude,
});

function tripStop(
  sequence: number,
  id: string,
  name: string,
  latitude: string | null = "7.000000",
  longitude: string | null = "80.000000",
) {
  return {
    sequence,
    stop: stop(id, name, latitude, longitude),
    arrival_datetime: "2030-09-15T20:30:00+05:30",
    departure_datetime: "2030-09-15T20:35:00+05:30",
    is_boarding_point: true,
    is_dropoff_point: true,
  };
}

const TRIP: PublicTrip = {
  id: "trip-1",
  code: "TR7KQ2M9",
  status: "scheduled",
  route: {
    id: "route-1",
    name: "Colombo – Kandy",
    route_number: "01",
    origin: stop("a", "Colombo", "6.933600", "79.850000"),
    destination: stop("c", "Kandy", "7.291900", "80.630500"),
    road_path: null,
  },
  operator: { id: "operator-1", name: "Ceylon Coach Services" },
  bus: {
    name: "Hill Country Express",
    registration_number: "WP NC-4521",
    bus_type: "super_luxury",
    bus_type_label: "Super Luxury",
    is_ac: true,
    facilities: [],
    seat_capacity: 4,
    seat_layout_name: "2x2 Super Luxury",
  },
  departure_datetime: "2030-09-15T20:30:00+05:30",
  arrival_datetime: "2030-09-15T23:30:00+05:30",
  duration_minutes: 180,
  price: "790.00",
  currency: "LKR",
  available_seats: 4,
  stops: [
    tripStop(1, "a", "Colombo", "6.933600", "79.850000"),
    tripStop(2, "b", "Kegalle", "7.251300", "80.346400"),
    tripStop(3, "c", "Kandy", "7.291900", "80.630500"),
  ],
};

const STOPS: TripStopsResponse = {
  trip: "trip-1",
  stops: TRIP.stops,
  boarding_points: [
    { sequence: 1, stop: TRIP.stops[0].stop, time: "2030-09-15T20:30:00+05:30" },
    { sequence: 2, stop: TRIP.stops[1].stop, time: "2030-09-15T21:30:00+05:30" },
  ],
  dropoff_points: [
    { sequence: 2, stop: TRIP.stops[1].stop, time: "2030-09-15T21:30:00+05:30" },
    { sequence: 3, stop: TRIP.stops[2].stop, time: "2030-09-15T23:30:00+05:30" },
  ],
};

const SEATS: TripSeatMap = {
  layout: { name: "2x2 Super Luxury", layout_type: "2x2", rows: 1, columns: 4 },
  seat_capacity: 4,
  available_seats: 3,
  booked_seats: 1,
  locked_seats: 0,
  seats: [
    { seat_number: "1", row: 1, column: 1, seat_type: "normal", status: "available", locked_by_me: false },
    { seat_number: "2", row: 1, column: 2, seat_type: "normal", status: "available", locked_by_me: false },
    { seat_number: "3", row: 1, column: 3, seat_type: "normal", status: "booked", locked_by_me: false },
    { seat_number: "4", row: 1, column: 4, seat_type: "normal", status: "available", locked_by_me: false },
  ],
  hold: null,
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("The seat-selection page", () => {
  beforeEach(() => {
    page.search = "";
    [...Object.values(trips), ...Object.values(seatLocks), ...Object.values(phone)].forEach((fn) =>
      fn.mockReset(),
    );
    trips.get.mockResolvedValue(TRIP);
    trips.stops.mockResolvedValue(STOPS);
    trips.seats.mockResolvedValue(SEATS);
  });

  it("shows the trip, the boarding pickers and the stop list", async () => {
    render(<TripView id="trip-1" />, { wrapper });

    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Where do you get on and off?")).toBeInTheDocument();
    expect(screen.getByText("Route & stops")).toBeInTheDocument();
  });

  it("shows the route map alongside the stop list", async () => {
    render(<TripView id="trip-1" />, { wrapper });

    expect(await screen.findByText("Route map")).toBeInTheDocument();
    // The map itself is loaded in the browser only; what matters here is that the page mounts
    // with it in place and nothing throws.
    expect(screen.getByText(/tap a stop to see its times/)).toBeInTheDocument();
  });

  it("still renders when no stop has been mapped", async () => {
    trips.get.mockResolvedValue({
      ...TRIP,
      stops: [tripStop(1, "a", "Colombo", null, null), tripStop(2, "c", "Kandy", null, null)],
    });

    render(<TripView id="trip-1" />, { wrapper });

    expect(await screen.findByText("Route map")).toBeInTheDocument();
    expect(screen.getByText("No map for this route yet")).toBeInTheDocument();
  });

  it("reaches the seat map once a journey is chosen", async () => {
    render(<TripView id="trip-1" />, { wrapper });

    await screen.findByRole("heading", { level: 1 });
    expect(screen.getAllByRole("button", { name: /Seats/ }).length).toBeGreaterThan(0);
  });

  it("lets a signed-out customer hold the seat they tapped with just their phone number", async () => {
    const person = userEvent.setup();
    page.search = "boarding=a&dropoff=c";
    phone.requestPhoneCode.mockResolvedValue({
      phone: "+94771234567",
      masked_phone: "+9477*****67",
      code_length: 6,
      expires_in: 300,
      resend_in: 60,
    });
    phone.signInWithPhone.mockResolvedValue({ access: "token", user: { id: "user-9" }, created: true });
    seatLocks.lock.mockResolvedValue({});
    render(<TripView id="trip-1" />, { wrapper });

    const choose = await screen.findAllByRole("button", { name: "Choose seats" });
    await person.click(choose[0]);
    await person.click(await screen.findByRole("button", { name: /^Seat 2,/ }));

    expect(await screen.findByText("Enter your mobile number to hold seat 2")).toBeInTheDocument();
    expect(seatLocks.lock).not.toHaveBeenCalled();

    await person.type(screen.getByLabelText("Mobile number"), "077 123 4567");
    await person.click(screen.getByRole("button", { name: "Text me a code" }));
    await person.type(await screen.findByLabelText("6-digit code"), "123456");

    await waitFor(() => expect(seatLocks.lock).toHaveBeenCalledWith("trip-1", ["2"]));
    expect(phone.signInWithPhone).toHaveBeenCalledWith("+94771234567", "123456");
  });
});
