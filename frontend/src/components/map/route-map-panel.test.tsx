import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PublicTripStop } from "@/lib/api/trip-types";
import { geometryForTrip } from "@/lib/map";

/**
 * Leaflet needs a real browser to do anything useful, so the map itself is stubbed here: what
 * matters is the panel around it — which states it shows, and what it hands the map.
 */
vi.mock("./route-map", () => ({
  RouteMap: ({ geometry }: { geometry: ReturnType<typeof geometryForTrip> }) => (
    <div data-testid="map">drawing {geometry.stops.length} stops</div>
  ),
}));

import { RouteMapPanel } from "./route-map-panel";

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

const MAPPED = geometryForTrip([stop("Colombo", 1), stop("Kandy", 2)]);

describe("RouteMapPanel", () => {
  it("draws the stops that have a position", async () => {
    const geometry = geometryForTrip([stop("Colombo", 1), stop("Kandy", 2)]);

    render(<RouteMapPanel geometry={geometry} />);

    expect(await screen.findByTestId("map")).toHaveTextContent("drawing 2 stops");
    expect(screen.queryByText(/not on the map yet/)).not.toBeInTheDocument();
  });

  it("says which stops the line skips", async () => {
    const geometry = geometryForTrip([
      stop("Colombo", 1),
      stop("Kadawatha", 2, null, null),
      stop("Kandy", 3),
    ]);

    render(<RouteMapPanel geometry={geometry} />);

    await screen.findByTestId("map");
    expect(screen.getByText(/1 stop on this route is not on the map yet/)).toBeInTheDocument();
    expect(screen.getByText(/Kadawatha/)).toBeInTheDocument();
  });

  it("explains itself instead of showing an empty map", () => {
    const geometry = geometryForTrip([
      stop("Colombo", 1, null, null),
      stop("Kandy", 2, null, null),
    ]);

    render(<RouteMapPanel geometry={geometry} />);

    expect(screen.getByText("No map for this route yet")).toBeInTheDocument();
    expect(screen.queryByTestId("map")).not.toBeInTheDocument();
  });

  it("takes a caller's wording for the empty state", () => {
    render(
      <RouteMapPanel
        geometry={geometryForTrip([stop("Colombo", 1, null, null)])}
        emptyDescription="Ask an administrator to map these stops."
      />,
    );

    expect(screen.getByText("Ask an administrator to map these stops.")).toBeInTheDocument();
  });
});

describe("what the line means", () => {
  it("says the line follows the road, and how far it is", () => {
    render(
      <RouteMapPanel
        geometry={MAPPED}
        roadPath={{
          geometry: "_p~iF~ps|U_ulLnnqC",
          precision: 5,
          distance_m: 116_400,
          duration_s: 8_160,
          source: "router.project-osrm.org",
          updated_at: null,
        }}
      />,
    );

    expect(screen.getByText(/Following the road/)).toBeInTheDocument();
    expect(screen.getByText(/116 km/)).toBeInTheDocument();
  });

  it("admits when the line is only the stops joined up", () => {
    render(<RouteMapPanel geometry={MAPPED} />);

    expect(screen.getByText(/dashed line joins the stops in order/)).toBeInTheDocument();
  });
});
