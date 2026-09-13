"use client";

import "leaflet/dist/leaflet.css";

import L from "leaflet";
import { useEffect, useMemo } from "react";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";

import { Button } from "@/components/ui/button";
import { env } from "@/lib/env";
import { formatClock } from "@/lib/datetime";
import {
  boundsOf,
  drawnPath,
  FALLBACK_CENTRE,
  FALLBACK_ZOOM,
  type LatLng,
  type MapStop,
  type RouteGeometry,
} from "@/lib/map";
import type { RoadPath } from "@/lib/api/trip-types";

import { busIcon, MARKER_COLOURS, stopIcon, type MarkerLook } from "./marker-icons";

/** Where the bus is right now. Nothing produces this yet — see docs/map.md. */
export interface BusLocation {
  latitude: number;
  longitude: number;
  /** ISO instant the position was recorded, if the source knows it. */
  recorded_at?: string | null;
}

export interface RouteMapProps {
  geometry: RouteGeometry;
  /**
   * The road the bus drives, from the API. Without it the map joins the stops with straight
   * lines, which is a rough sketch of the journey rather than the route itself.
   */
  roadPath?: RoadPath | null;
  /** The traveller's own choices, highlighted and labelled. */
  boardingStopId?: string | null;
  dropoffStopId?: string | null;
  /**
   * Which stops may be chosen from the map. These come from the server's own boarding and
   * drop-off lists, so the map can never offer a journey the API would refuse.
   */
  selectableBoardingIds?: ReadonlySet<string>;
  selectableDropoffIds?: ReadonlySet<string>;
  onSelectBoarding?: (stopId: string) => void;
  onSelectDropoff?: (stopId: string) => void;
  busLocation?: BusLocation | null;
  /** Tailwind height classes; maps need an explicit height to render at all. */
  heightClassName?: string;
  interactive?: boolean;
}

/** Keeps the whole journey in view, including after stops are added, removed or reordered. */
function FitToRoute({ points }: { points: LatLng[] }) {
  const map = useMap();
  // The key is the shape of the route, so a reorder refits and a re-render does not.
  const signature = points.map(([lat, lng]) => `${lat},${lng}`).join("|");

  useEffect(() => {
    const bounds = boundsOf(points);
    if (!bounds) return;
    if (points.length === 1) {
      map.setView(points[0], 13);
      return;
    }
    map.fitBounds([bounds.southWest, bounds.northEast], { padding: [24, 24] });
    // `signature` stands in for `points`, which is a new array on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, signature]);

  return null;
}

/** Leaflet sizes itself on mount; a map inside a tab or a card can mount at zero height. */
function ResizeOnShow() {
  const map = useMap();
  useEffect(() => {
    const invalidate = () => map.invalidateSize();
    const frame = window.requestAnimationFrame(invalidate);
    window.addEventListener("resize", invalidate);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", invalidate);
    };
  }, [map]);
  return null;
}

function lookFor(stop: MapStop, boardingStopId?: string | null, dropoffStopId?: string | null) {
  const chosen = stop.id === boardingStopId || stop.id === dropoffStopId;
  return (chosen ? "selected" : stop.role) satisfies MarkerLook;
}

function time(value: string | null | undefined): string | null {
  return value ? formatClock(value) : null;
}

function StopPopup({
  stop,
  isBoarding,
  isDropoff,
  canBoard,
  canAlight,
  onSelectBoarding,
  onSelectDropoff,
}: {
  stop: MapStop;
  isBoarding: boolean;
  isDropoff: boolean;
  canBoard: boolean;
  canAlight: boolean;
  onSelectBoarding?: (stopId: string) => void;
  onSelectDropoff?: (stopId: string) => void;
}) {
  const arrival = time(stop.arrival);
  const departure = time(stop.departure);

  return (
    <div className="min-w-44 space-y-2">
      <div>
        <p className="font-heading text-sm font-semibold">{stop.name}</p>
        <p className="text-xs text-muted-foreground">
          Stop {stop.sequence} · {stop.city}
        </p>
      </div>

      {(arrival || departure) && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
          {arrival && (
            <>
              <dt className="text-muted-foreground">Arrives</dt>
              <dd className="tabular-nums">{arrival}</dd>
            </>
          )}
          {departure && (
            <>
              <dt className="text-muted-foreground">Departs</dt>
              <dd className="tabular-nums">{departure}</dd>
            </>
          )}
        </dl>
      )}

      <p className="text-xs text-muted-foreground">
        {stop.isBoardingPoint ? "Picks up" : "No pick-up"} ·{" "}
        {stop.isDropoffPoint ? "Sets down" : "No set-down"}
      </p>

      {isBoarding && <p className="text-xs font-medium text-amber-700">Your boarding point</p>}
      {isDropoff && <p className="text-xs font-medium text-amber-700">Your drop-off point</p>}

      {(onSelectBoarding || onSelectDropoff) && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {onSelectBoarding && canBoard && !isBoarding && (
            <Button size="sm" variant="outline" onClick={() => onSelectBoarding(stop.id)}>
              Board here
            </Button>
          )}
          {onSelectDropoff && canAlight && !isDropoff && (
            <Button size="sm" variant="outline" onClick={() => onSelectDropoff(stop.id)}>
              Get off here
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The journey on a map: a marker per stop, a line through them in travel order, and the
 * traveller's own boarding and drop-off points picked out.
 *
 * This renders in the browser only (Leaflet touches `window` on import) — reach it through
 * `RouteMapPanel`, which handles the dynamic import, the loading state and routes with no
 * coordinates yet.
 */
export function RouteMap({
  geometry,
  roadPath = null,
  boardingStopId = null,
  dropoffStopId = null,
  selectableBoardingIds,
  selectableDropoffIds,
  onSelectBoarding,
  onSelectDropoff,
  busLocation = null,
  heightClassName = "h-72 sm:h-96",
  interactive = true,
}: RouteMapProps) {
  const path = useMemo(() => drawnPath(geometry.stops, roadPath), [geometry.stops, roadPath]);
  // Fit to the road when we have it: a road bends outside the box its stops sit in.
  const bounds = useMemo(() => boundsOf(path.points), [path.points]);

  return (
    <div
      className={`${heightClassName} w-full overflow-hidden rounded-xl border bg-muted print:hidden`}
    >
      <MapContainer
        bounds={bounds ? [bounds.southWest, bounds.northEast] : undefined}
        center={bounds ? undefined : FALLBACK_CENTRE}
        zoom={bounds ? undefined : FALLBACK_ZOOM}
        scrollWheelZoom={false}
        dragging={interactive}
        touchZoom={interactive}
        doubleClickZoom={interactive}
        zoomControl={interactive}
        attributionControl
        className="size-full"
        // The stop list beside the map is the accessible equivalent of everything drawn here.
        aria-label="Map of the route"
      >
        <TileLayer
          url={env.NEXT_PUBLIC_MAP_TILE_URL}
          attribution={env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION}
          maxZoom={19}
          detectRetina
        />
        <FitToRoute points={path.points} />
        <ResizeOnShow />

        {path.points.length > 1 && (
          <Polyline
            positions={path.points}
            pathOptions={{
              color: MARKER_COLOURS.intermediate,
              weight: path.kind === "road" ? 5 : 3,
              opacity: path.kind === "road" ? 0.85 : 0.6,
              // A dashed line says "this is not the road, only the order of the stops".
              dashArray: path.kind === "road" ? undefined : "6 8",
              lineJoin: "round",
              lineCap: "round",
            }}
          />
        )}

        {geometry.stops.map((stop) => {
          const isBoarding = stop.id === boardingStopId;
          const isDropoff = stop.id === dropoffStopId;
          return (
            <Marker
              key={stop.id}
              position={[stop.latitude, stop.longitude]}
              icon={stopIcon(lookFor(stop, boardingStopId, dropoffStopId), stop.sequence)}
              title={`${stop.sequence}. ${stop.name}`}
              alt={`Stop ${stop.sequence}: ${stop.name}`}
            >
              <Popup>
                <StopPopup
                  stop={stop}
                  isBoarding={isBoarding}
                  isDropoff={isDropoff}
                  canBoard={selectableBoardingIds?.has(stop.id) ?? false}
                  canAlight={selectableDropoffIds?.has(stop.id) ?? false}
                  onSelectBoarding={onSelectBoarding}
                  onSelectDropoff={onSelectDropoff}
                />
              </Popup>
            </Marker>
          );
        })}

        {busLocation && (
          <Marker
            position={[busLocation.latitude, busLocation.longitude]}
            icon={busIcon()}
            title="The bus"
            zIndexOffset={1000}
          >
            <Popup>
              <p className="text-sm font-semibold">The bus</p>
              {busLocation.recorded_at && (
                <p className="text-xs text-muted-foreground">
                  Last seen {formatClock(busLocation.recorded_at)}
                </p>
              )}
            </Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  );
}

/** Exported for the coordinate picker, which needs Leaflet's own types. */
export type { L };
