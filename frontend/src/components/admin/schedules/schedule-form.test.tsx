import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { AdminTripSchedule } from "@/lib/api/admin-types";

import { ScheduleForm } from "./schedule-form";

const stop = (id: string, name: string) => ({ id, name, city: name, active: true });

const SCHEDULE: AdminTripSchedule = {
  id: "schedule-1",
  route: "route-1",
  route_summary: {
    id: "route-1",
    name: "Kandy – Nuwara Eliya",
    route_number: "",
    origin: stop("a", "Kandy"),
    destination: stop("b", "Nuwara Eliya"),
    base_fare: "620.00",
    active: true,
  },
  bus: "bus-1",
  bus_summary: {
    id: "bus-1",
    name: "Misty Hills Shuttle",
    registration_number: "CP-2211",
    bus_type: "normal",
    seat_capacity: 25,
    seat_layout: "layout-1",
    seat_layout_name: "2+1 Compact · 25 seats",
    facilities: [],
    active: true,
  },
  operator: "operator-1",
  operator_name: "Ceylon Coach Services",
  departure_time: "14:30:00",
  base_price: "620.00",
  recurrence: "weekly",
  weekdays: [5, 6],
  start_date: "2030-01-01",
  end_date: null,
  active: true,
  last_generated_until: null,
  trip_count: 0,
  upcoming_trip_count: 0,
  duration_minutes: 165,
  created_at: "2030-01-01T00:00:00Z",
  updated_at: "2030-01-01T00:00:00Z",
};

function renderForm(onSubmit = vi.fn().mockResolvedValue(undefined)) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ScheduleForm schedule={SCHEDULE} submitLabel="Save schedule" onSubmit={onSubmit} />
    </QueryClientProvider>,
  );
  return onSubmit;
}

describe("ScheduleForm", () => {
  it("shows the selected weekdays and a plain-language summary", () => {
    renderForm();

    expect(screen.getByRole("button", { name: "Saturday" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Monday" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Runs every Saturday, Sunday at 14:30, from Tue, 1 Jan 2030.")).toBeInTheDocument();
  });

  it("submits the chosen weekdays", async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm();

    await user.click(screen.getByRole("button", { name: "Saturday" }));
    await user.click(screen.getByRole("button", { name: "Save schedule" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      route: "route-1",
      bus: "bus-1",
      departure_time: "14:30",
      base_price: "620.00",
      recurrence: "weekly",
      weekdays: [6],
      start_date: "2030-01-01",
      end_date: null,
      active: true,
    });
  });

  it("needs at least one weekday", async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm();

    await user.click(screen.getByRole("button", { name: "Saturday" }));
    await user.click(screen.getByRole("button", { name: "Sunday" }));
    await user.click(screen.getByRole("button", { name: "Save schedule" }));

    expect(await screen.findByText("Pick at least one weekday.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
