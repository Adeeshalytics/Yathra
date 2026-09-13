/**
 * Leaflet itself, rendered.
 *
 * Markers are opened with `fireEvent`, not `userEvent`: two synthetic clicks in quick
 * succession make Leaflet simulate a double-click, and a jsdom container has no real geometry
 * to project one onto.
 *
 * jsdom is enough for Leaflet to build its panes, request a tile and place markers, so these
 * tests check the things that would otherwise only show up in a browser: tiles come from the
 * configured server, the attribution OpenStreetMap requires is on the page, there is a marker
 * per mapped stop, and the line is drawn.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { PublicTripStop } from "@/lib/api/trip-types";
import { geometryForTrip } from "@/lib/map";

import { RouteMap } from "./route-map";

function stop(
  name: string,
  sequence: number,
  latitude: string,
  longitude: string,
  extra: Partial<PublicTripStop> = {},
): PublicTripStop {
  return {
    sequence,
    stop: { id: name.toLowerCase(), name, city: name, latitude, longitude },
    arrival_datetime: "2030-09-15T20:30:00+05:30",
    departure_datetime: "2030-09-15T20:35:00+05:30",
    is_boarding_point: true,
    is_dropoff_point: true,
    ...extra,
  };
}

const COLOMBO_TO_KANDY = geometryForTrip([
  stop("Colombo", 1, "6.933600", "79.850000"),
  stop("Kegalle", 2, "7.251300", "80.346400"),
  stop("Kandy", 3, "7.291900", "80.630500"),
]);

/** A short road that bends well away from the straight Colombo–Kandy line. */
const ROAD = {
  geometry: "_p~iF~ps|U_ulLnnqC",
  precision: 5,
  distance_m: 116_000,
  duration_s: 8_160,
  source: "router.project-osrm.org",
  updated_at: "2030-09-15T09:00:00+05:30",
};

describe("RouteMap", () => {
  it("draws the road the bus actually takes when the backend has one", () => {
    const { container } = render(<RouteMap geometry={COLOMBO_TO_KANDY} roadPath={ROAD} />);

    const line = container.querySelector("path.leaflet-interactive");
    expect(line).toBeTruthy();
    // A road is drawn solid and thicker; the straight-line fallback is dashed.
    expect(line?.getAttribute("stroke-dasharray")).toBeNull();
    expect(line?.getAttribute("stroke-width")).toBe("5");
  });

  it("marks the straight-line fallback as the approximation it is", () => {
    const { container } = render(<RouteMap geometry={COLOMBO_TO_KANDY} />);

    const line = container.querySelector("path.leaflet-interactive");
    expect(line?.getAttribute("stroke-dasharray")).toBe("6 8");
    expect(line?.getAttribute("stroke-width")).toBe("3");
  });

  it("draws the tiles, the attribution, a marker per stop and the line", () => {
    const { container } = render(<RouteMap geometry={COLOMBO_TO_KANDY} />);

    const tile = container.querySelector<HTMLImageElement>("img.leaflet-tile");
    expect(tile?.src).toContain("tile.openstreetmap.org");
    expect(container.querySelector(".leaflet-control-attribution")?.textContent).toContain(
      "OpenStreetMap",
    );
    expect(container.querySelectorAll(".yathra-stop-marker")).toHaveLength(3);
    expect(container.querySelectorAll("path.leaflet-interactive")).toHaveLength(1);
  });

  it("numbers the markers so they match the stop list", () => {
    const { container } = render(<RouteMap geometry={COLOMBO_TO_KANDY} />);

    const labels = [...container.querySelectorAll(".yathra-stop-marker text")].map(
      (node) => node.textContent,
    );
    expect(labels).toEqual(["1", "2", "3"]);
  });

  it("draws no line for a single mapped stop", () => {
    const geometry = geometryForTrip([stop("Colombo", 1, "6.933600", "79.850000")]);

    const { container } = render(<RouteMap geometry={geometry} />);

    expect(container.querySelectorAll(".yathra-stop-marker")).toHaveLength(1);
    expect(container.querySelectorAll("path.leaflet-interactive")).toHaveLength(0);
  });

  it("shows a stop's times and rules when its marker is opened", async () => {
    const geometry = geometryForTrip([
      stop("Colombo", 1, "6.933600", "79.850000"),
      stop("Kandy", 2, "7.291900", "80.630500", { is_boarding_point: false }),
    ]);
    const { container } = render(<RouteMap geometry={geometry} />);

    const [, kandy] = container.querySelectorAll(".yathra-stop-marker");
    fireEvent.click(kandy);

    const popup = await screen.findByText("Kandy");
    const card = popup.closest("div")?.parentElement as HTMLElement;
    expect(within(card).getByText("Stop 2 · Kandy")).toBeInTheDocument();
    expect(within(card).getByText("Arrives")).toBeInTheDocument();
    expect(within(card).getByText(/No pick-up/)).toBeInTheDocument();
  });

  it("lets a traveller board at a stop the server offered", async () => {
    const user = userEvent.setup();
    const onSelectBoarding = vi.fn();
    const { container } = render(
      <RouteMap
        geometry={COLOMBO_TO_KANDY}
        selectableBoardingIds={new Set(["colombo"])}
        selectableDropoffIds={new Set(["kandy"])}
        onSelectBoarding={onSelectBoarding}
        onSelectDropoff={vi.fn()}
      />,
    );

    fireEvent.click(container.querySelectorAll(".yathra-stop-marker")[0]);
    await user.click(await screen.findByRole("button", { name: "Board here" }));

    expect(onSelectBoarding).toHaveBeenCalledWith("colombo");
  });

  it("offers nothing at a stop the server did not", async () => {
    const { container } = render(
      <RouteMap
        geometry={COLOMBO_TO_KANDY}
        // Kegalle is in neither list: the API would refuse a journey starting or ending there.
        selectableBoardingIds={new Set(["colombo"])}
        selectableDropoffIds={new Set(["kandy"])}
        onSelectBoarding={vi.fn()}
        onSelectDropoff={vi.fn()}
      />,
    );

    fireEvent.click(container.querySelectorAll(".yathra-stop-marker")[1]);

    await screen.findByText("Kegalle");
    expect(screen.queryByRole("button", { name: "Board here" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Get off here" })).not.toBeInTheDocument();
  });

  it("marks the traveller's own boarding and drop-off points", async () => {
    const { container } = render(
      <RouteMap geometry={COLOMBO_TO_KANDY} boardingStopId="colombo" dropoffStopId="kandy" />,
    );

    fireEvent.click(container.querySelectorAll(".yathra-stop-marker")[0]);

    expect(await screen.findByText("Your boarding point")).toBeInTheDocument();
  });

  it("shows the bus when a position is supplied", () => {
    const { container } = render(
      <RouteMap
        geometry={COLOMBO_TO_KANDY}
        busLocation={{ latitude: 7.1, longitude: 80.1, recorded_at: "2030-09-15T21:10:00+05:30" }}
      />,
    );

    expect(container.querySelectorAll(".yathra-bus-marker")).toHaveLength(1);
  });

  it("has no bus marker by default", () => {
    const { container } = render(<RouteMap geometry={COLOMBO_TO_KANDY} />);

    expect(container.querySelectorAll(".yathra-bus-marker")).toHaveLength(0);
  });
});
