import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { StopTime, TripSearchResult } from "@/lib/api/trip-types";

import { BusCard } from "./bus-card";

const stop = (id: string, name: string) => ({ id, name, city: name });
const at = (sequence: number, id: string, name: string, time: string): StopTime => ({
  sequence,
  stop: stop(id, name),
  time: `${time}:00+05:30`,
});

export const NIGHT_TRIP: TripSearchResult = {
  id: "trip-1",
  code: "TR7KQ2M9",
  route: {
    id: "route-1",
    name: "Colombo – Batticaloa",
    route_number: "",
    origin: stop("a", "Colombo"),
    destination: stop("e", "Batticaloa"),
  },
  operator: { id: "operator-1", name: "Ceylon Coach Services" },
  bus: {
    name: "Batticaloa Night Express",
    registration_number: "WP NC-4521",
    bus_type: "super_luxury",
    bus_type_label: "Super Luxury",
    is_ac: true,
    facilities: ["ac", "wifi"],
    seat_capacity: 45,
    seat_layout_name: "2+2 Standard · 45 seats",
  },
  departure_datetime: "2030-09-15T20:30:00+05:30",
  arrival_datetime: "2030-09-16T05:30:00+05:30",
  boarding: at(1, "a", "Colombo", "2030-09-15T20:30"),
  dropoff: at(5, "e", "Batticaloa", "2030-09-16T05:30"),
  duration_minutes: 540,
  price: "2500.00",
  currency: "LKR",
  available_seats: 42,
  boarding_points: [at(1, "a", "Colombo", "2030-09-15T20:30"), at(2, "b", "Kadawatha", "2030-09-15T21:05")],
  dropoff_points: [at(4, "d", "Dambulla", "2030-09-16T00:30"), at(5, "e", "Batticaloa", "2030-09-16T05:30")],
};

describe("BusCard", () => {
  it("shows the journey the way customers compare buses", () => {
    render(<BusCard trip={NIGHT_TRIP} passengers={2} backQuery="from=a&to=e" />);

    expect(screen.getByRole("heading", { name: "Batticaloa Night Express" })).toBeInTheDocument();
    expect(screen.getByText("Ceylon Coach Services")).toBeInTheDocument();
    expect(screen.getByText("WP NC-4521")).toBeInTheDocument();
    // Headline times are paragraphs; the boarding-point list repeats them in smaller spans.
    expect(screen.getByText("8:30 PM", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText(/^5:30 AM/, { selector: "p" })).toHaveTextContent("5:30 AM+1");
    expect(screen.getByText("9h 00m")).toBeInTheDocument();
    expect(screen.getByText("3 stops")).toBeInTheDocument();
    expect(screen.getByText("Super Luxury")).toBeInTheDocument();
    expect(screen.getByText("42 seats available")).toBeInTheDocument();
    expect(screen.getByText(/LKR\s2,500$/)).toBeInTheDocument();
    expect(screen.getByText(/LKR\s5,000 for 2/)).toBeInTheDocument();
    expect(screen.getByText("2 boarding points · 2 drop-off points", { exact: false })).toBeInTheDocument();

    const link = screen.getByRole("link", { name: /Select seats on Batticaloa Night Express/ });
    expect(link).toHaveAttribute(
      "href",
      "/trips/trip-1?passengers=2&boarding=a&dropoff=e&back=from%3Da%26to%3De",
    );
  });

  it("warns when only a few seats are left", () => {
    render(<BusCard trip={{ ...NIGHT_TRIP, available_seats: 3 }} passengers={1} />);

    expect(screen.getByText("Only 3 seats left")).toBeInTheDocument();
  });
});
