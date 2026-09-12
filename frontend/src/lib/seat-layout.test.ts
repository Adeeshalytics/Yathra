import { describe, expect, it } from "vitest";

import type { Seat, SeatType } from "@/lib/api/admin-types";

import { applyTool, countSeats, renumberSeats, seatsOutside, validateSeats } from "./seat-layout";

function seat(number: string, row: number, column: number, type: SeatType = "window", available = true): Seat {
  return { seat_number: number, row, column, seat_type: type, is_available: available };
}

// A tiny 2 x 5 bus: driver front-right, one passenger row of four.
const VALID: Seat[] = [
  seat("D", 1, 5, "driver", false),
  seat("1", 2, 1),
  seat("2", 2, 2, "aisle"),
  seat("3", 2, 4, "aisle"),
  seat("4", 2, 5),
];

describe("validateSeats", () => {
  it("accepts a valid layout", () => {
    expect(validateSeats(2, 5, VALID)).toEqual([]);
  });

  it.each([
    ["two seats in one cell", [...VALID, seat("5", 2, 1)], /share row 2, column 1/],
    ["a repeated seat number", [...VALID, seat("1", 2, 3)], /used 2 times/],
    ["a seat outside the grid", [...VALID, seat("9", 3, 1)], /outside the 2 × 5 grid/],
    ["no driver", VALID.slice(1), /exactly one driver/],
    ["two drivers", [...VALID, seat("D2", 1, 1, "driver", false)], /exactly one driver/],
    ["no passenger seats", VALID.slice(0, 1), /at least one passenger seat/],
    ["an invalid seat number", [...VALID.slice(0, 4), seat("4@", 2, 5)], /letters, digits or dashes/],
  ])("rejects %s", (_, seats, message) => {
    expect(validateSeats(2, 5, seats).join("\n")).toMatch(message);
  });

  it("rejects grids outside the supported size", () => {
    expect(validateSeats(2, 9, VALID).join("\n")).toMatch(/between 2 and 7 columns/);
  });
});

describe("countSeats", () => {
  it("separates bookable, blocked and reserved seats", () => {
    const seats = [...VALID, seat("5", 3, 1, "reserved"), seat("6", 3, 2, "normal", false)];
    expect(countSeats(seats)).toEqual({
      seatCount: 6,
      bookableCount: 4,
      unavailableCount: 1,
      reservedCount: 1,
    });
  });
});

describe("renumberSeats", () => {
  it("numbers passengers front-to-back, left-to-right and names crew seats", () => {
    const shuffled = [
      seat("x", 3, 1),
      seat("y", 2, 2, "aisle"),
      seat("z", 1, 1, "conductor", false),
      seat("q", 2, 1),
      seat("d", 1, 5, "driver", false),
    ];
    const byPosition = Object.fromEntries(
      renumberSeats(shuffled).map((s) => [`${s.row}:${s.column}`, s.seat_number]),
    );
    expect(byPosition).toEqual({ "1:1": "C", "1:5": "D", "2:1": "1", "2:2": "2", "3:1": "3" });
  });
});

describe("applyTool", () => {
  it("paints a new seat with the next free number", () => {
    const result = applyTool(VALID, 3, 1, "normal");
    expect(result).toContainEqual(seat("5", 3, 1, "normal"));
  });

  it("erases a seat", () => {
    expect(applyTool(VALID, 2, 1, "erase")).toHaveLength(VALID.length - 1);
  });

  it("toggles availability of passenger seats but never of crew seats", () => {
    const toggled = applyTool(VALID, 2, 1, "toggle-availability");
    expect(toggled.find((s) => s.seat_number === "1")?.is_available).toBe(false);
    const driver = applyTool(VALID, 1, 5, "toggle-availability").find((s) => s.seat_type === "driver");
    expect(driver?.is_available).toBe(false);
  });

  it("makes crew seats unavailable when painted over a passenger seat", () => {
    const result = applyTool(VALID, 2, 1, "conductor");
    expect(result.find((s) => s.row === 2 && s.column === 1)).toMatchObject({
      seat_type: "conductor",
      is_available: false,
    });
  });
});

it("finds seats that fall outside a smaller grid", () => {
  expect(seatsOutside(VALID, 2, 4).map((s) => s.seat_number)).toEqual(["D", "4"]);
});
