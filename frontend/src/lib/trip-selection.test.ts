import { describe, expect, it } from "vitest";

import type { StopTime, TripSeat } from "@/lib/api/trip-types";

import { resolveSegment, sortSeatNumbers, usableBoardings } from "./trip-selection";

const point = (sequence: number, name: string, city = name): StopTime => ({
  sequence,
  stop: { id: name.toLowerCase(), name, city },
  time: "2030-09-15T20:30:00+05:30",
});

// Colombo → Kadawatha → Kurunegala → Dambulla → Batticaloa
const BOARDINGS = [point(1, "Colombo"), point(2, "Kadawatha"), point(3, "Kurunegala"), point(4, "Dambulla")];
const DROPOFFS = [point(2, "Kadawatha"), point(3, "Kurunegala"), point(4, "Dambulla"), point(5, "Batticaloa")];

const seat = (seat_number: string, row: number, column: number): TripSeat => ({
  seat_number,
  row,
  column,
  seat_type: "window",
  status: "available",
  locked_by_me: false,
});

describe("boarding and drop-off", () => {
  it("uses the customer's choice when it is valid", () => {
    const segment = resolveSegment({ boardings: BOARDINGS, dropoffs: DROPOFFS, boardingId: "kurunegala", dropoffId: "dambulla" });

    expect(segment.boarding?.stop.name).toBe("Kurunegala");
    expect(segment.dropoff?.stop.name).toBe("Dambulla");
    expect(segment.dropoffOptions.map((option) => option.stop.name)).toEqual(["Dambulla", "Batticaloa"]);
  });

  it("never offers a drop-off before the boarding point", () => {
    const segment = resolveSegment({ boardings: BOARDINGS, dropoffs: DROPOFFS, boardingId: "dambulla", dropoffId: "kadawatha" });

    expect(segment.dropoffOptions.map((option) => option.stop.name)).toEqual(["Batticaloa"]);
    expect(segment.dropoff?.stop.name).toBe("Batticaloa");
  });

  it("falls back to the searched cities, then the whole route", () => {
    expect(resolveSegment({ boardings: BOARDINGS, dropoffs: DROPOFFS, fromCity: "kadawatha", toCity: "Kurunegala" }))
      .toMatchObject({ boarding: { sequence: 2 }, dropoff: { sequence: 3 } });
    expect(resolveSegment({ boardings: BOARDINGS, dropoffs: DROPOFFS, boardingId: "unknown" }))
      .toMatchObject({ boarding: { sequence: 1 }, dropoff: { sequence: 5 } });
  });

  it("drops boarding points with nowhere left to go", () => {
    expect(usableBoardings([...BOARDINGS, point(5, "Batticaloa")], DROPOFFS)).toHaveLength(4);
  });
});

describe("seat order", () => {
  it("orders seat numbers the way they sit in the bus", () => {
    const seats = [seat("10", 4, 1), seat("2", 2, 2), seat("9", 3, 4)];

    expect(sortSeatNumbers(["10", "9", "2"], seats)).toEqual(["2", "9", "10"]);
  });
});
