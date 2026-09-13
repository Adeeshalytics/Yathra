/**
 * Turning the API's stops into something a map can draw.
 *
 * Coordinates are optional on a stop — a route is usable long before anyone has mapped every
 * bus stand on it — so everything here is written for partial data: a stop without a position
 * is kept, marked, and listed beside the map rather than silently dropped.
 */

import type { StopBrief } from "@/lib/api/admin-types";
import type { PublicStop, PublicTripStop, RoadPath, StopTime } from "@/lib/api/trip-types";

/** Where a stop sits on the journey. Origin and destination are styled differently. */
export type StopRole = "origin" | "intermediate" | "destination";

export interface MapStop {
  id: string;
  name: string;
  city: string;
  /** 1-based position along the route. */
  sequence: number;
  latitude: number;
  longitude: number;
  role: StopRole;
  /** ISO instants, when the source knows them (a trip does; a route template does not). */
  arrival?: string | null;
  departure?: string | null;
  isBoardingPoint: boolean;
  isDropoffPoint: boolean;
}

/** A stop that belongs to the journey but has no position yet. */
export interface UnmappedStop {
  id: string;
  name: string;
  city: string;
  sequence: number;
}

export interface RouteGeometry {
  stops: MapStop[];
  unmapped: UnmappedStop[];
  /** Every stop on the journey, mapped or not, in travel order. */
  total: number;
}

export type LatLng = [number, number];

export interface MapBounds {
  southWest: LatLng;
  northEast: LatLng;
}

/** Sri Lanka, for the rare case where a map has to render with nothing on it. */
export const FALLBACK_CENTRE: LatLng = [7.8731, 80.7718];
export const FALLBACK_ZOOM = 7;

function coordinate(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A position is only usable when both halves are present and on the planet. */
export function positionOf(
  stop: Pick<PublicStop, "latitude" | "longitude"> | Pick<StopBrief, "latitude" | "longitude">,
): LatLng | null {
  const latitude = coordinate(stop.latitude);
  const longitude = coordinate(stop.longitude);
  if (latitude === null || longitude === null) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  if (latitude === 0 && longitude === 0) return null; // null island: unset data, not a bus stand
  return [latitude, longitude];
}

function roleAt(index: number, count: number): StopRole {
  if (index === 0) return "origin";
  if (index === count - 1) return "destination";
  return "intermediate";
}

interface SourceStop {
  id: string;
  name: string;
  city: string;
  sequence: number;
  position: LatLng | null;
  arrival?: string | null;
  departure?: string | null;
  isBoardingPoint: boolean;
  isDropoffPoint: boolean;
}

function build(source: SourceStop[]): RouteGeometry {
  const ordered = [...source].sort((a, b) => a.sequence - b.sequence);
  const stops: MapStop[] = [];
  const unmapped: UnmappedStop[] = [];

  ordered.forEach((stop, index) => {
    if (!stop.position) {
      unmapped.push({ id: stop.id, name: stop.name, city: stop.city, sequence: stop.sequence });
      return;
    }
    stops.push({
      id: stop.id,
      name: stop.name,
      city: stop.city,
      sequence: stop.sequence,
      latitude: stop.position[0],
      longitude: stop.position[1],
      // The role describes the journey, not the mapped subset, so an unmapped origin does not
      // promote the second stop to "origin".
      role: roleAt(index, ordered.length),
      arrival: stop.arrival ?? null,
      departure: stop.departure ?? null,
      isBoardingPoint: stop.isBoardingPoint,
      isDropoffPoint: stop.isDropoffPoint,
    });
  });

  return { stops, unmapped, total: ordered.length };
}

/** The stops of a trip (they carry real arrival and departure instants). */
export function geometryForTrip(stops: readonly PublicTripStop[]): RouteGeometry {
  return build(
    stops.map((stop) => ({
      id: stop.stop.id,
      name: stop.stop.name,
      city: stop.stop.city,
      sequence: stop.sequence,
      position: positionOf(stop.stop),
      arrival: stop.arrival_datetime,
      departure: stop.departure_datetime,
      isBoardingPoint: stop.is_boarding_point,
      isDropoffPoint: stop.is_dropoff_point,
    })),
  );
}

/** The stops of a route template, or any ordered list of stops without times. */
export function geometryForStops(
  stops: readonly { stop: StopBrief | PublicStop; sequence: number }[],
  options: { boarding?: (index: number) => boolean; dropoff?: (index: number) => boolean } = {},
): RouteGeometry {
  return build(
    stops.map((entry, index) => ({
      id: entry.stop.id,
      name: entry.stop.name,
      city: entry.stop.city,
      sequence: entry.sequence,
      position: positionOf(entry.stop),
      isBoardingPoint: options.boarding?.(index) ?? true,
      isDropoffPoint: options.dropoff?.(index) ?? true,
    })),
  );
}

/** Which stops a customer may actually pick, straight from what the server offered. */
export function selectableIds(points: readonly StopTime[] | undefined): Set<string> {
  return new Set((points ?? []).map((point) => point.stop.id));
}

/** The rectangle that holds every point, padded a little so markers are never on the edge. */
export function boundsOf(points: readonly LatLng[], padding = 0.02): MapBounds | null {
  if (points.length === 0) return null;
  const latitudes = points.map(([latitude]) => latitude);
  const longitudes = points.map(([, longitude]) => longitude);
  return {
    southWest: [Math.min(...latitudes) - padding, Math.min(...longitudes) - padding],
    northEast: [Math.max(...latitudes) + padding, Math.max(...longitudes) + padding],
  };
}

export function pathOf(stops: readonly MapStop[]): LatLng[] {
  return stops.map((stop) => [stop.latitude, stop.longitude]);
}


/**
 * The road, decoded.
 *
 * A bus follows roads, not straight lines, so the backend asks a routing service for the real
 * geometry and stores it as an encoded polyline. This is the standard algorithm for that
 * encoding: signed offsets, five bits at a time, chunk by chunk.
 */
export function decodePolyline(encoded: string, precision = 5): LatLng[] {
  const factor = 10 ** precision;
  const points: LatLng[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      if (Number.isNaN(byte)) return points; // truncated input: keep what we decoded
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    latitude += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      if (Number.isNaN(byte)) return points;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    longitude += result & 1 ? ~(result >> 1) : result >> 1;

    points.push([latitude / factor, longitude / factor]);
  }

  return points;
}

/** How the line on the map was worked out — worth saying, because one of them is a guess. */
export type PathKind = "road" | "direct";

export interface DrawnPath {
  points: LatLng[];
  kind: PathKind;
  /** Road distance in kilometres, when the routing service measured it. */
  kilometres: number | null;
}

/**
 * What the line will be, without decoding it — for captions drawn outside the map.
 */
export function describePath(road: RoadPath | null | undefined): {
  kind: PathKind;
  kilometres: number | null;
} {
  if (!road?.geometry) return { kind: "direct", kilometres: null };
  return { kind: "road", kilometres: road.distance_m ? road.distance_m / 1000 : null };
}

/**
 * The line to draw: the real road when we have it, otherwise the stops joined up.
 *
 * The fallback is deliberately kept — a route is drawable the moment its stops are mapped, long
 * before anyone has run the routing service over it — but the map says which one it is showing.
 */
export function drawnPath(stops: readonly MapStop[], road: RoadPath | null | undefined): DrawnPath {
  const points = road?.geometry ? decodePolyline(road.geometry, road.precision ?? 5) : [];
  if (points.length > 1) return { points, ...describePath(road) };
  return { points: pathOf(stops), kind: "direct", kilometres: null };
}
