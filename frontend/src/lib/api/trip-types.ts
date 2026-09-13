/** Types for the public trip API (/api/v1/trips/...). Money arrives as decimal strings. */

import type { BusFacility, BusType, SeatType } from "./admin-types";
import type { Paginated, TripStatus } from "./types";

export interface PublicStop {
  id: string;
  name: string;
  city: string;
  /** Decimal strings, or null until someone puts the stop on the map. */
  latitude: string | null;
  longitude: string | null;
}

/**
 * The road the bus drives, worked out once by the backend and cached on the route.
 * Null until a routing service has answered — the map then joins the stops with straight lines.
 */
export interface RoadPath {
  /** Encoded polyline, origin to destination. */
  geometry: string;
  /** Decimal places the encoding used (5 = ~1 m). */
  precision: number;
  distance_m: number | null;
  duration_s: number | null;
  source: string;
  updated_at: string | null;
}

export interface PublicRoute {
  id: string;
  name: string;
  route_number: string;
  origin: PublicStop;
  destination: PublicStop;
  road_path: RoadPath | null;
}

export interface PublicBus {
  name: string;
  registration_number: string;
  bus_type: BusType;
  bus_type_label: string;
  is_ac: boolean;
  facilities: BusFacility[];
  seat_capacity: number;
  seat_layout_name: string | null;
}

/** A boarding point (time = departure there) or drop-off point (time = arrival there). */
export interface StopTime {
  sequence: number;
  stop: PublicStop;
  time: string;
}

export interface TripSearchResult {
  id: string;
  code: string;
  route: PublicRoute;
  operator: { id: string; name: string };
  bus: PublicBus;
  departure_datetime: string;
  arrival_datetime: string;
  /** Where the customer gets on / off for the searched journey. */
  boarding: StopTime;
  dropoff: StopTime;
  duration_minutes: number;
  price: string;
  currency: string;
  available_seats: number;
  boarding_points: StopTime[];
  dropoff_points: StopTime[];
}

export interface SearchPlace {
  city: string;
  label: string;
  stop_id: string | null;
}

export interface FacetOption {
  value: string;
  label: string;
  count: number;
}

export interface SearchFacets {
  total: number;
  operators: { id: string; name: string; count: number }[];
  bus_types: FacetOption[];
  departure_periods: FacetOption[];
  ac: { ac: number; non_ac: number };
  price: { min: string | null; max: string | null };
}

export interface TripSearchResponse extends Paginated<TripSearchResult> {
  search: { from: SearchPlace; to: SearchPlace; date: string; passengers: number; sort: string };
  facets: SearchFacets;
  /** False when no route links the two places at all (on any date). */
  route_exists: boolean;
  nearest_available_date: string | null;
}

export interface PublicTripStop {
  sequence: number;
  stop: PublicStop;
  arrival_datetime: string;
  departure_datetime: string;
  is_boarding_point: boolean;
  is_dropoff_point: boolean;
}

export interface PublicTrip {
  id: string;
  code: string;
  status: TripStatus;
  route: PublicRoute;
  operator: { id: string; name: string };
  bus: PublicBus;
  departure_datetime: string;
  arrival_datetime: string;
  duration_minutes: number;
  price: string;
  currency: string;
  available_seats: number;
  stops: PublicTripStop[];
}

export interface TripStopsResponse {
  trip: string;
  stops: PublicTripStop[];
  boarding_points: StopTime[];
  dropoff_points: StopTime[];
}

/** `locked` = temporarily held by a customer who is booking it (by you if `locked_by_me`). */
export type SeatStatus = "available" | "locked" | "booked" | "blocked";

export interface TripSeat {
  seat_number: string;
  row: number;
  column: number;
  seat_type: SeatType;
  status: SeatStatus;
  locked_by_me: boolean;
}

/** The server's authoritative price. Never calculated in the browser. */
export interface PriceQuote {
  currency: string;
  unit_price: string;
  seats: number;
  subtotal: string;
  service_fee: string;
  discount: string;
  tax: string;
  total: string;
}

/** A customer's seat locks on one trip. They share one expiry. */
export interface SeatHold {
  trip: string;
  seats: { id: string; seat_number: string; expires_at: string }[];
  expires_at: string | null;
  seconds_remaining: number;
  lock_minutes: number;
  quote: PriceQuote | null;
}

export interface TripSeatMap {
  layout: { name: string; layout_type: string; rows: number; columns: number };
  seat_capacity: number;
  available_seats: number;
  booked_seats: number;
  locked_seats: number;
  seats: TripSeat[];
  /** The signed-in viewer's hold (null for guests). */
  hold: SeatHold | null;
}
