import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/errors";
import type { SeatHold, TripSeat } from "@/lib/api/trip-types";

import { passengerFieldErrors, seatAction } from "./booking";

const seat = (seat_number: string, status: TripSeat["status"], locked_by_me = false): TripSeat => ({
  seat_number,
  row: 2,
  column: 1,
  seat_type: "window",
  status,
  locked_by_me,
});

function hold(...numbers: string[]): SeatHold {
  return {
    trip: "trip-1",
    seats: numbers.map((number) => ({ id: `lock-${number}`, seat_number: number, expires_at: "2030-01-01T00:05:00Z" })),
    expires_at: "2030-01-01T00:05:00Z",
    seconds_remaining: 300,
    lock_minutes: 5,
    quote: null,
  };
}

describe("seatAction", () => {
  it("locks free seats while more are needed", () => {
    expect(seatAction(seat("15", "available"), null, 2, true)).toEqual({ kind: "lock" });
    expect(seatAction(seat("16", "available"), hold("15"), 2, true)).toEqual({ kind: "lock" });
  });

  it("releases your own seat", () => {
    expect(seatAction(seat("15", "locked", true), hold("15"), 2, true)).toEqual({ kind: "release", lockId: "lock-15" });
  });

  it("swaps the seat when travelling alone", () => {
    expect(seatAction(seat("16", "available"), hold("15"), 1, true)).toEqual({ kind: "swap", releaseLockId: "lock-15" });
  });

  it("asks larger groups to free a seat first", () => {
    expect(seatAction(seat("17", "available"), hold("15", "16"), 2, true)).toEqual({ kind: "limit" });
  });

  it("ignores seats that can't be taken and asks guests to sign in", () => {
    expect(seatAction(seat("15", "booked"), null, 1, true)).toEqual({ kind: "unavailable" });
    expect(seatAction(seat("15", "locked"), null, 1, true)).toEqual({ kind: "unavailable" });
    expect(seatAction(seat("15", "blocked"), null, 1, true)).toEqual({ kind: "unavailable" });
    expect(seatAction(seat("15", "available"), null, 1, false)).toEqual({ kind: "sign-in" });
  });
});

describe("passengerFieldErrors", () => {
  it("reads per-passenger messages from a validation error", () => {
    const error = new ApiError({
      status: 400,
      code: "validation_error",
      message: "Please correct the highlighted fields.",
      details: { passengers: [{}, { phone: ["Enter a valid phone number."], email: ["Enter a valid email address."] }] },
    });

    expect(passengerFieldErrors(error)).toEqual([
      { index: 1, field: "phone", message: "Enter a valid phone number." },
      { index: 1, field: "email", message: "Enter a valid email address." },
    ]);
    expect(passengerFieldErrors(new Error("offline"))).toEqual([]);
  });
});
