import { describe, expect, it } from "vitest";

import {
  busSchema,
  operatorSchema,
  routeSchema,
  stopSchema,
  toBusPayload,
  toRoutePayload,
  toStopPayload,
  type RouteFormValues,
} from "./admin";

function issues(result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) {
  return result.success
    ? []
    : (result.error?.issues ?? []).map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

const stop = (id: string) =>
  ({ id, name: id, city: id, active: true, latitude: null, longitude: null }) as const;
const row = (id: string, arrival: number, departure = arrival, boarding = true, dropoff = true) => ({
  stop: stop(id),
  arrival: String(arrival),
  departure: String(departure),
  boarding,
  dropoff,
});

function route(overrides: Partial<RouteFormValues> = {}): RouteFormValues {
  return {
    name: "Colombo – Kandy",
    route_number: "01",
    description: "",
    base_fare: "790",
    active: true,
    stops: [row("Colombo", 0, 0, true, false), row("Kadawatha", 45, 50), row("Kandy", 210, 210, false, true)],
    ...overrides,
  };
}

describe("routeSchema", () => {
  it("accepts a valid timetable", () => {
    expect(issues(routeSchema.safeParse(route()))).toEqual([]);
  });

  it.each([
    ["fewer than two stops", { stops: [row("Colombo", 0)] }, "stops", /at least two stops/],
    [
      "a repeated stop",
      { stops: [row("Colombo", 0), row("Kadawatha", 45), row("Kadawatha", 90)] },
      "stops.2.stop",
      /already stop 2/,
    ],
    [
      "departing before arriving",
      { stops: [row("Colombo", 0), row("Kadawatha", 45, 40), row("Kandy", 210)] },
      "stops.1.departure",
      /before arrival/,
    ],
    [
      "stops out of order",
      { stops: [row("Colombo", 0), row("Kadawatha", 45, 50), row("Kandy", 40)] },
      "stops.2.arrival",
      /after leaving Kadawatha/,
    ],
    [
      "an origin that doesn't depart at zero",
      { stops: [row("Colombo", 5, 5), row("Kandy", 210)] },
      "stops.0.arrival",
      /0 minutes/,
    ],
    [
      "a destination without drop-off",
      { stops: [row("Colombo", 0), row("Kandy", 210, 210, true, false)] },
      "stops.1.dropoff",
      /get off at the destination/,
    ],
    ["a negative fare", { base_fare: "-1" }, "base_fare", /0 or more/],
  ])("rejects %s", (_, overrides, path, message) => {
    const found = issues(routeSchema.safeParse(route(overrides as Partial<RouteFormValues>)));
    expect(found).toContainEqual({ path, message: expect.stringMatching(message) });
  });

  it("converts form values to the API payload", () => {
    const payload = toRoutePayload(route({ route_number: "48a", base_fare: "" }));
    expect(payload.route_number).toBe("48A");
    expect(payload.base_fare).toBeNull();
    expect(payload.stops[1]).toEqual({
      stop: "Kadawatha",
      arrival_offset_minutes: 45,
      departure_offset_minutes: 50,
      is_boarding_point: true,
      is_dropoff_point: true,
    });
  });
});

describe("busSchema", () => {
  const bus = {
    operator: "op-1",
    registration_number: " wp  nb 1234 ",
    name: "Coastal Express",
    bus_type: "ac" as const,
    seat_layout: "",
    seat_capacity: "45",
    facilities: ["ac" as const],
    active: true,
  };

  it("accepts Sri Lankan plates in common formats", () => {
    for (const plate of ["NB-1234", "wp nb 1234", "65-1234", "CAB 1234"]) {
      expect(busSchema.safeParse({ ...bus, registration_number: plate }).success).toBe(true);
    }
  });

  it.each([
    ["registration_number", "HELLO"],
    ["seat_capacity", "0"],
    ["seat_capacity", "91"],
    ["operator", ""],
  ])("rejects an invalid %s", (field, value) => {
    const found = issues(busSchema.safeParse({ ...bus, [field]: value }));
    expect(found.map((issue) => issue.path)).toContain(field);
  });

  it("normalises the payload", () => {
    expect(toBusPayload(busSchema.parse(bus))).toMatchObject({
      registration_number: "WP NB 1234",
      seat_layout: null,
      seat_capacity: 45,
    });
  });
});

describe("stopSchema", () => {
  const base = { name: "Ella", city: "Ella", latitude: "", longitude: "", active: true };

  it("allows missing coordinates and sends them as null", () => {
    expect(toStopPayload(stopSchema.parse(base))).toMatchObject({ latitude: null, longitude: null });
  });

  it("requires both coordinates together", () => {
    expect(issues(stopSchema.safeParse({ ...base, latitude: "6.87" })).map((i) => i.path)).toEqual(["longitude"]);
  });

  it("rejects coordinates out of range", () => {
    const found = issues(stopSchema.safeParse({ ...base, latitude: "95", longitude: "80" }));
    expect(found.map((i) => i.path)).toContain("latitude");
  });
});

describe("operatorSchema", () => {
  it("validates the contact phone number", () => {
    const operator = {
      company_name: "Sunrise Travels",
      registration_number: "PV-123456",
      contact_phone: "12345",
      contact_email: "ops@sunrise.example",
      address: "12 Temple Road, Galle",
      status: "pending" as const,
    };
    expect(issues(operatorSchema.safeParse(operator)).map((i) => i.path)).toEqual(["contact_phone"]);
    expect(operatorSchema.safeParse({ ...operator, contact_phone: "011 234 5678" }).success).toBe(true);
  });
});
