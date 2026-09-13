import { describe, expect, it } from "vitest";

import type { PublicTripStop } from "@/lib/api/trip-types";

import {
  boundsOf,
  decodePolyline,
  describePath,
  drawnPath,
  geometryForStops,
  geometryForTrip,
  pathOf,
  positionOf,
  selectableIds,
} from "./map";

function stop(
  name: string,
  sequence: number,
  latitude: string | null = "7.000000",
  longitude: string | null = "80.000000",
): PublicTripStop {
  return {
    sequence,
    stop: { id: name.toLowerCase(), name, city: name, latitude, longitude },
    arrival_datetime: "2030-09-15T20:30:00+05:30",
    departure_datetime: "2030-09-15T20:35:00+05:30",
    is_boarding_point: true,
    is_dropoff_point: true,
  };
}

describe("positionOf", () => {
  it("reads decimal strings from the API", () => {
    expect(positionOf({ latitude: "6.933600", longitude: "79.850000" })).toEqual([6.9336, 79.85]);
  });

  it("refuses half a position", () => {
    expect(positionOf({ latitude: "6.9336", longitude: null })).toBeNull();
    expect(positionOf({ latitude: null, longitude: "79.85" })).toBeNull();
  });

  it("refuses positions that are not on the planet", () => {
    expect(positionOf({ latitude: "95", longitude: "80" })).toBeNull();
    expect(positionOf({ latitude: "7", longitude: "181" })).toBeNull();
    expect(positionOf({ latitude: "not a number", longitude: "80" })).toBeNull();
  });

  it("treats 0,0 as unset rather than a bus stand in the Atlantic", () => {
    expect(positionOf({ latitude: "0", longitude: "0" })).toBeNull();
  });
});

describe("geometryForTrip", () => {
  it("keeps the stops in travel order whatever order they arrive in", () => {
    const geometry = geometryForTrip([stop("Kandy", 2), stop("Colombo", 1), stop("Matale", 3)]);

    expect(geometry.stops.map((point) => point.name)).toEqual(["Colombo", "Kandy", "Matale"]);
    expect(geometry.total).toBe(3);
  });

  it("marks the ends of the journey", () => {
    const geometry = geometryForTrip([stop("Colombo", 1), stop("Kandy", 2), stop("Matale", 3)]);

    expect(geometry.stops.map((point) => point.role)).toEqual([
      "origin",
      "intermediate",
      "destination",
    ]);
  });

  it("handles the shortest possible route", () => {
    const geometry = geometryForTrip([stop("Colombo", 1), stop("Kandy", 2)]);

    expect(geometry.stops.map((point) => point.role)).toEqual(["origin", "destination"]);
    expect(pathOf(geometry.stops)).toHaveLength(2);
  });

  it("sets an unmapped stop aside instead of dropping it silently", () => {
    const geometry = geometryForTrip([
      stop("Colombo", 1),
      stop("Kadawatha", 2, null, null),
      stop("Kandy", 3),
    ]);

    expect(geometry.stops.map((point) => point.name)).toEqual(["Colombo", "Kandy"]);
    expect(geometry.unmapped.map((point) => point.name)).toEqual(["Kadawatha"]);
    expect(geometry.total).toBe(3);
  });

  it("does not promote the second stop when the origin is unmapped", () => {
    const geometry = geometryForTrip([
      stop("Colombo", 1, null, null),
      stop("Kadawatha", 2),
      stop("Kandy", 3),
    ]);

    // Kadawatha is still an intermediate stop; the journey did not start there.
    expect(geometry.stops.map((point) => point.role)).toEqual(["intermediate", "destination"]);
  });

  it("carries the times and the pick-up rules through", () => {
    const only = geometryForTrip([{ ...stop("Colombo", 1), is_dropoff_point: false }]).stops[0];

    expect(only.departure).toBe("2030-09-15T20:35:00+05:30");
    expect(only.isBoardingPoint).toBe(true);
    expect(only.isDropoffPoint).toBe(false);
  });

  it("gives back nothing to draw when no stop is mapped", () => {
    const geometry = geometryForTrip([stop("Colombo", 1, null, null), stop("Kandy", 2, null, null)]);

    expect(geometry.stops).toEqual([]);
    expect(geometry.unmapped).toHaveLength(2);
  });
});

describe("geometryForStops", () => {
  it("reads an admin route, sequence and all", () => {
    const geometry = geometryForStops([
      {
        sequence: 1,
        stop: { id: "a", name: "Colombo", city: "Colombo", active: true, latitude: "6.9", longitude: "79.8" },
      },
      {
        sequence: 2,
        stop: { id: "b", name: "Kandy", city: "Kandy", active: true, latitude: "7.2", longitude: "80.6" },
      },
    ]);

    expect(geometry.stops.map((point) => point.sequence)).toEqual([1, 2]);
    expect(geometry.stops[0].latitude).toBeCloseTo(6.9);
  });
});

describe("bounds and paths", () => {
  it("wraps every point with a little breathing room", () => {
    const bounds = boundsOf([
      [6.9, 79.8],
      [7.2, 80.6],
    ]);

    expect(bounds?.southWest[0]).toBeCloseTo(6.88);
    expect(bounds?.northEast[1]).toBeCloseTo(80.62);
  });

  it("has no bounds for an empty route", () => {
    expect(boundsOf([])).toBeNull();
  });
});

describe("selectableIds", () => {
  it("mirrors exactly what the server offered", () => {
    const points = [
      {
        sequence: 1,
        stop: { id: "a", name: "Colombo", city: "Colombo", latitude: null, longitude: null },
        time: "2030-09-15T20:30:00+05:30",
      },
    ];

    expect(selectableIds(points).has("a")).toBe(true);
    expect(selectableIds(points).has("b")).toBe(false);
    expect(selectableIds(undefined).size).toBe(0);
  });
});


describe("decodePolyline", () => {
  it("decodes the reference example from the encoding spec", () => {
    // The canonical test vector: three points around Mountain View.
    const points = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");

    expect(points).toHaveLength(3);
    expect(points[0][0]).toBeCloseTo(38.5, 5);
    expect(points[0][1]).toBeCloseTo(-120.2, 5);
    expect(points[1][0]).toBeCloseTo(40.7, 5);
    expect(points[2][1]).toBeCloseTo(-126.453, 5);
  });

  it("honours the precision the encoder used", () => {
    const five = decodePolyline("_p~iF~ps|U", 5);
    const six = decodePolyline("_p~iF~ps|U", 6);

    expect(five[0][0]).toBeCloseTo(38.5, 5);
    expect(six[0][0]).toBeCloseTo(3.85, 5);
  });

  it("keeps what it could read when the string is truncated", () => {
    const whole = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    const cut = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq");

    expect(cut.length).toBeLessThan(whole.length);
    expect(cut[0]).toEqual(whole[0]);
  });

  it("has nothing to draw for an empty string", () => {
    expect(decodePolyline("")).toEqual([]);
  });
});

describe("drawnPath", () => {
  const stops = geometryForTrip([stop("Colombo", 1, "6.9336", "79.8500"), stop("Kandy", 2, "7.2919", "80.6305")]).stops;
  const road = {
    // Two points well off the straight line between Colombo and Kandy.
    geometry: "_p~iF~ps|U_ulLnnqC",
    precision: 5,
    distance_m: 116_000,
    duration_s: 8_160,
    source: "router.project-osrm.org",
    updated_at: "2030-09-15T09:00:00+05:30",
  };

  it("draws the road when the backend has worked one out", () => {
    const path = drawnPath(stops, road);

    expect(path.kind).toBe("road");
    expect(path.kilometres).toBe(116);
    expect(path.points).toHaveLength(2);
    // The road is its own geometry, not the stop coordinates.
    expect(path.points[0][0]).not.toBeCloseTo(6.9336, 3);
  });

  it("falls back to joining the stops when there is no road yet", () => {
    const path = drawnPath(stops, null);

    expect(path.kind).toBe("direct");
    expect(path.kilometres).toBeNull();
    expect(path.points).toEqual(pathOf(stops));
  });

  it("falls back when the stored geometry is unusable", () => {
    const path = drawnPath(stops, { ...road, geometry: "" });

    expect(path.kind).toBe("direct");
    expect(path.points).toEqual(pathOf(stops));
  });
});

describe("describePath", () => {
  it("reports the road and its distance without decoding it", () => {
    expect(describePath({
      geometry: "abc",
      precision: 5,
      distance_m: 116_000,
      duration_s: 0,
      source: "osrm",
      updated_at: null,
    })).toEqual({ kind: "road", kilometres: 116 });
  });

  it("reports a straight line when nothing has been routed", () => {
    expect(describePath(null)).toEqual({ kind: "direct", kilometres: null });
  });
});
