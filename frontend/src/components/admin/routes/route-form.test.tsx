import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { AdminRouteDetail, AdminRouteStop } from "@/lib/api/admin-types";

import { RouteForm } from "./route-form";

const stop = (id: string, name: string) => ({ id, name, city: name, active: true });

function routeStop(sequence: number, id: string, name: string, arrival: number, departure: number, boarding: boolean, dropoff: boolean): AdminRouteStop {
  return {
    sequence,
    stop: stop(id, name),
    arrival_offset_minutes: arrival,
    departure_offset_minutes: departure,
    is_boarding_point: boarding,
    is_dropoff_point: dropoff,
  };
}

const ROUTE: AdminRouteDetail = {
  id: "route-1",
  name: "Colombo – Kandy",
  route_number: "01",
  description: "",
  base_fare: "790.00",
  active: true,
  origin: stop("a", "Colombo"),
  destination: stop("c", "Kandy"),
  stop_count: 3,
  duration_minutes: 210,
  trip_count: 0,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  stops: [
    routeStop(1, "a", "Colombo", 0, 0, true, false),
    routeStop(2, "b", "Kadawatha", 45, 50, true, true),
    routeStop(3, "c", "Kandy", 210, 210, false, true),
  ],
};

function renderForm(onSubmit = vi.fn().mockResolvedValue(undefined)) {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <RouteForm route={ROUTE} submitLabel="Save route" onSubmit={onSubmit} />
    </QueryClientProvider>,
  );
  return onSubmit;
}

const stopNames = () =>
  within(screen.getByRole("list", { name: "Route stops in order" }))
    .getAllByRole("listitem")
    .map((item) => item.textContent ?? "");

describe("RouteForm", () => {
  it("submits the ordered timetable", async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm();

    await user.click(screen.getByRole("button", { name: "Save route" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Colombo – Kandy",
        base_fare: "790.00",
        stops: [
          { stop: "a", arrival_offset_minutes: 0, departure_offset_minutes: 0, is_boarding_point: true, is_dropoff_point: false },
          { stop: "b", arrival_offset_minutes: 45, departure_offset_minutes: 50, is_boarding_point: true, is_dropoff_point: true },
          { stop: "c", arrival_offset_minutes: 210, departure_offset_minutes: 210, is_boarding_point: false, is_dropoff_point: true },
        ],
      }),
    );
  });

  it("reorders stops, keeps the origin at minute zero and blocks impossible times", async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm();

    await user.click(screen.getByRole("button", { name: "Move Colombo down" }));

    expect(stopNames()[0]).toContain("Kadawatha");
    expect(stopNames()[0]).toContain("Origin");
    expect(screen.getByLabelText("Arrives after", { selector: "#stop-0-arrival" })).toHaveValue(0);

    await user.click(screen.getByRole("button", { name: "Save route" }));

    expect(await screen.findByText("Must arrive after leaving Kadawatha.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("removes a stop", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("button", { name: "Remove Kadawatha" }));

    expect(stopNames()).toHaveLength(2);
    expect(stopNames()[1]).toContain("Destination");
  });
});
