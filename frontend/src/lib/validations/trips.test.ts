import { describe, expect, it } from "vitest";

import {
  scheduleSchema,
  toSchedulePayload,
  toTripPayload,
  tripSchema,
  type ScheduleFormValues,
  type TripFormValues,
  type TripStopRow,
} from "./trips";

const row = (sequence: number, name: string, arrival: number, departure: number): TripStopRow => ({
  sequence,
  stop: { id: name.toLowerCase(), name, city: name, active: true },
  arrival,
  departure,
  boarding: sequence < 5,
  dropoff: sequence > 1,
});

// Colombo 20:30 → Kadawatha 21:00 → Kurunegala 22:30 → Dambulla 00:30 → Batticaloa 05:30
const TRIP: TripFormValues = {
  route: "route-1",
  bus: "bus-1",
  date: "2026-09-15",
  time: "20:30",
  base_price: "2500",
  active: true,
  stops: [
    row(1, "Colombo", 0, 0),
    row(2, "Kadawatha", 30, 35),
    row(3, "Kurunegala", 120, 125),
    row(4, "Dambulla", 240, 245),
    row(5, "Batticaloa", 540, 540),
  ],
};

describe("trip payloads", () => {
  it("turns stop offsets into Sri Lankan timestamps", () => {
    const payload = toTripPayload(TRIP);

    expect(payload.departure_datetime).toBe("2026-09-15T20:30:00+05:30");
    expect(payload.base_price).toBe("2500");
    expect(payload.stops?.[3]).toEqual({
      sequence: 4,
      arrival_datetime: "2026-09-16T00:30:00+05:30",
      departure_datetime: "2026-09-16T00:35:00+05:30",
    });
    expect(payload.stops?.[4].arrival_datetime).toBe("2026-09-16T05:30:00+05:30");
  });

  it("leaves the price out when blank so the route fare applies", () => {
    expect("base_price" in toTripPayload({ ...TRIP, base_price: " " })).toBe(false);
  });

  it("flags a stop reached before the bus leaves the previous one", () => {
    const stops = TRIP.stops.map((stop) => (stop.sequence === 3 ? { ...stop, arrival: 35 } : stop));

    const result = tripSchema.safeParse({ ...TRIP, stops });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({
        message: "Must arrive after leaving Kadawatha.",
        path: ["stops", 2, "arrival"],
      }),
    );
  });

  it("rejects journeys over 72 hours", () => {
    const stops = TRIP.stops.map((stop) => (stop.sequence === 5 ? { ...stop, arrival: 73 * 60, departure: 73 * 60 } : stop));

    expect(tripSchema.safeParse({ ...TRIP, stops }).success).toBe(false);
  });
});

const SCHEDULE: ScheduleFormValues = {
  route: "route-1",
  bus: "bus-1",
  departure_time: "20:30",
  base_price: "",
  recurrence: "weekly",
  weekdays: [6, 5],
  start_date: "2026-09-12",
  end_date: "",
  active: true,
};

describe("schedule payloads", () => {
  it("needs at least one weekday for weekly schedules", () => {
    const result = scheduleSchema.safeParse({ ...SCHEDULE, weekdays: [] });

    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({ message: "Pick at least one weekday.", path: ["weekdays"] }),
    );
  });

  it("rejects an end date before the start", () => {
    expect(scheduleSchema.safeParse({ ...SCHEDULE, end_date: "2026-09-01" }).success).toBe(false);
  });

  it("sorts weekdays, drops them for daily schedules and omits a blank price", () => {
    expect(toSchedulePayload(SCHEDULE)).toEqual({
      route: "route-1",
      bus: "bus-1",
      departure_time: "20:30",
      recurrence: "weekly",
      weekdays: [5, 6],
      start_date: "2026-09-12",
      end_date: null,
      active: true,
    });
    expect(toSchedulePayload({ ...SCHEDULE, recurrence: "daily" }).weekdays).toEqual([]);
  });
});
