import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { TripSeat, TripSeatMap } from "@/lib/api/trip-types";

import { BusSeatPicker, SeatPickerLegend } from "./bus-seat-picker";

const seat = (
  seat_number: string,
  column: number,
  seat_type: TripSeat["seat_type"],
  status: TripSeat["status"],
  locked_by_me = false,
): TripSeat => ({ seat_number, row: 2, column, seat_type, status, locked_by_me });

const MAP: TripSeatMap = {
  layout: { name: "Mini", layout_type: "custom", rows: 3, columns: 4 },
  seat_capacity: 5,
  available_seats: 1,
  booked_seats: 1,
  locked_seats: 2,
  hold: null,
  seats: [
    { seat_number: "D", row: 1, column: 4, seat_type: "driver", status: "blocked", locked_by_me: false },
    seat("1", 1, "window", "available"),
    seat("2", 2, "aisle", "booked"),
    seat("3", 3, "aisle", "locked", true),
    seat("4", 4, "window", "locked"),
    { ...seat("5", 1, "reserved", "blocked"), row: 3 },
  ],
};

describe("BusSeatPicker", () => {
  it("draws every seat with its state for this trip", () => {
    render(<BusSeatPicker map={MAP} onToggle={vi.fn()} />);

    expect(screen.getByRole("img", { name: "Driver" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Seat 1, window seat, available" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Seat 2, aisle seat, booked" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Seat 3, aisle seat, your seat" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Seat 4, window seat, held by another passenger" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Seat 5, reserved seat, not available" })).toBeDisabled();
  });

  it("reports taps on free seats and on your own", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<BusSeatPicker map={MAP} onToggle={onToggle} />);

    await user.click(screen.getByRole("button", { name: /Seat 1,/ }));
    await user.click(screen.getByRole("button", { name: /Seat 3,/ }));
    await user.click(screen.getByRole("button", { name: /Seat 4,/ }));

    expect(onToggle.mock.calls.map(([tapped]) => tapped.seat_number)).toEqual(["1", "3"]);
  });

  it("pauses other seats while a request is in flight", () => {
    render(<BusSeatPicker map={MAP} onToggle={vi.fn()} pendingSeat="1" />);

    expect(screen.getByRole("button", { name: /Seat 1,/ })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: /Seat 3,/ })).toBeDisabled();
  });

  it("explains the colours", () => {
    render(<SeatPickerLegend />);

    for (const label of ["Available", "Your seats", "Being booked", "Booked", "Not for sale", "Driver"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});
