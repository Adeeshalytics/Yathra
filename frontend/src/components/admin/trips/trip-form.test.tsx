import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { AdminTripDetail, AdminTripStop } from "@/lib/api/admin-types";

import { TripForm } from "./trip-form";

const stop = (id: string, name: string) =>
  ({ id, name, city: name, active: true, latitude: null, longitude: null }) as const;

function tripStop(sequence: number, name: string, arrival: string, departure: string): AdminTripStop {
  return {
    sequence,
    stop: stop(`stop-${sequence}`, name),
    arrival_datetime: `${arrival}:00+05:30`,
    departure_datetime: `${departure}:00+05:30`,
    is_boarding_point: sequence < 5,
    is_dropoff_point: sequence > 1,
  };
}

// The Colombo → Batticaloa night service: 20:30 departure, 05:30 arrival the next morning.
const TRIP: AdminTripDetail = {
  id: "trip-1",
  code: "TR7KQ2M9",
  route: "route-1",
  route_summary: {
    id: "route-1",
    name: "Colombo – Batticaloa",
    route_number: "",
    origin: stop("stop-1", "Colombo Fort"),
    destination: stop("stop-5", "Batticaloa"),
    base_fare: "1850.00",
    active: true,
  },
  bus: "bus-1",
  bus_summary: {
    id: "bus-1",
    name: "Batticaloa Night Express",
    registration_number: "WP NC-4521",
    bus_type: "super_luxury",
    seat_capacity: 31,
    seat_layout: "layout-1",
    seat_layout_name: "2+1 Executive · 31 seats",
    facilities: ["ac"],
    active: true,
  },
  operator: "operator-1",
  operator_name: "Ceylon Coach Services",
  schedule: null,
  departure_datetime: "2030-09-15T20:30:00+05:30",
  estimated_arrival_datetime: "2030-09-16T05:30:00+05:30",
  status: "scheduled",
  base_price: "2500.00",
  active: true,
  booking_count: 0,
  booked_seats: 0,
  available_seats: 31,
  created_at: "2030-01-01T00:00:00Z",
  updated_at: "2030-01-01T00:00:00Z",
  cancellation_reason: "",
  cancelled_at: null,
  stops: [
    tripStop(1, "Colombo Fort", "2030-09-15T20:30", "2030-09-15T20:30"),
    tripStop(2, "Kadawatha", "2030-09-15T21:00", "2030-09-15T21:05"),
    tripStop(3, "Kurunegala", "2030-09-15T22:30", "2030-09-15T22:35"),
    tripStop(4, "Dambulla", "2030-09-16T00:30", "2030-09-16T00:35"),
    tripStop(5, "Batticaloa", "2030-09-16T05:30", "2030-09-16T05:30"),
  ],
};

function renderForm(onSubmit = vi.fn().mockResolvedValue(undefined)) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TripForm trip={TRIP} submitLabel="Save trip" onSubmit={onSubmit} />
    </QueryClientProvider>,
  );
  return onSubmit;
}

describe("TripForm", () => {
  it("shows stop times as clock times that roll past midnight", () => {
    renderForm();

    expect(screen.getByLabelText("Arrives at Kadawatha")).toHaveValue("21:00");
    expect(screen.getByLabelText("Arrives at Dambulla")).toHaveValue("00:30");
    expect(screen.getByLabelText("Arrives at Batticaloa")).toHaveValue("05:30");
    expect(screen.getAllByText("+1 day")).toHaveLength(3);
  });

  it("submits adjusted stop times and keeps the dwell at the stop", async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm();

    fireEvent.change(screen.getByLabelText("Arrives at Kurunegala"), { target: { value: "22:40" } });
    await user.click(screen.getByRole("button", { name: "Save trip" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0][0];
    expect(payload).toMatchObject({
      route: "route-1",
      bus: "bus-1",
      departure_datetime: "2030-09-15T20:30:00+05:30",
      base_price: "2500.00",
      active: true,
    });
    expect(payload.stops[2]).toEqual({
      sequence: 3,
      arrival_datetime: "2030-09-15T22:40:00+05:30",
      departure_datetime: "2030-09-15T22:45:00+05:30",
    });
    expect(payload.stops[4].arrival_datetime).toBe("2030-09-16T05:30:00+05:30");
  });

  it("moves every stop with the departure time", async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm();

    fireEvent.change(screen.getByLabelText("Departure time"), { target: { value: "21:30" } });

    expect(screen.getByLabelText("Arrives at Batticaloa")).toHaveValue("06:30");
    await user.click(screen.getByRole("button", { name: "Save trip" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].stops[4].arrival_datetime).toBe("2030-09-16T06:30:00+05:30");
  });

  it("blocks a stop reached before the bus has left the previous one", async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm();

    fireEvent.change(screen.getByLabelText("Arrives at Kadawatha"), { target: { value: "20:30" } });
    await user.click(screen.getByRole("button", { name: "Save trip" }));

    expect(await screen.findByText("Must arrive after leaving Colombo Fort.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
