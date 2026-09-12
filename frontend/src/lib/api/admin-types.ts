/** Types for the admin API (/api/v1/admin/...). Money and coordinates arrive as decimal strings. */

import type { OperatorStatus } from "./types";

export interface AdminOperator {
  id: string;
  company_name: string;
  registration_number: string;
  contact_phone: string;
  contact_email: string;
  address: string;
  status: OperatorStatus;
  bus_count: number;
  active_bus_count: number;
  member_count: number;
  created_at: string;
  updated_at: string;
}

export interface OperatorPayload {
  company_name: string;
  registration_number: string;
  contact_phone: string;
  contact_email: string;
  address: string;
  status: OperatorStatus;
}

export type BusType = "normal" | "ac" | "luxury" | "super_luxury";
export type BusFacility = "ac" | "wifi" | "usb_charging" | "reclining_seats" | "tv" | "toilet";

export interface AdminBus {
  id: string;
  operator: string;
  operator_name: string;
  registration_number: string;
  name: string;
  bus_type: BusType;
  seat_capacity: number;
  seat_layout: string | null;
  seat_layout_name: string | null;
  facilities: BusFacility[];
  active: boolean;
  trip_count: number;
  created_at: string;
  updated_at: string;
}

export interface BusPayload {
  operator: string;
  registration_number: string;
  name: string;
  bus_type: BusType;
  seat_capacity: number;
  seat_layout: string | null;
  facilities: BusFacility[];
  active: boolean;
}

export type SeatType = "normal" | "window" | "aisle" | "driver" | "conductor" | "reserved";
export type SeatLayoutType = "2x2" | "2x1" | "custom";

export interface Seat {
  seat_number: string;
  row: number;
  column: number;
  seat_type: SeatType;
  is_available: boolean;
}

export interface SeatLayoutSummary {
  id: string;
  name: string;
  layout_type: SeatLayoutType;
  rows: number;
  columns: number;
  description: string;
  active: boolean;
  seat_count: number;
  bookable_seat_count: number;
  bus_count: number;
  created_at: string;
  updated_at: string;
}

export interface SeatLayoutDetail extends SeatLayoutSummary {
  seats: Seat[];
}

export interface SeatLayoutPayload {
  name: string;
  layout_type: SeatLayoutType;
  rows: number;
  columns: number;
  description: string;
  active: boolean;
  seats: Seat[];
}

export interface GenerateLayoutPayload {
  layout_type: "2x2" | "2x1";
  passenger_rows: number;
  back_row_full: boolean;
  conductor_seat: boolean;
}

export interface GeneratedLayout {
  layout_type: "2x2" | "2x1";
  rows: number;
  columns: number;
  seats: Seat[];
  seat_count: number;
  bookable_seat_count: number;
}

export interface StopBrief {
  id: string;
  name: string;
  city: string;
  active: boolean;
}

export interface AdminStop extends StopBrief {
  latitude: string | null;
  longitude: string | null;
  route_count: number;
  created_at: string;
  updated_at: string;
}

export interface StopPayload {
  name: string;
  city: string;
  latitude: string | null;
  longitude: string | null;
  active: boolean;
}

export interface AdminRouteStop {
  sequence: number;
  stop: StopBrief;
  arrival_offset_minutes: number;
  departure_offset_minutes: number;
  is_boarding_point: boolean;
  is_dropoff_point: boolean;
}

export interface AdminRouteSummary {
  id: string;
  name: string;
  route_number: string;
  description: string;
  base_fare: string | null;
  active: boolean;
  origin: StopBrief;
  destination: StopBrief;
  stop_count: number;
  duration_minutes: number | null;
  trip_count: number;
  created_at: string;
  updated_at: string;
}

export interface AdminRouteDetail extends AdminRouteSummary {
  stops: AdminRouteStop[];
}

export interface RouteStopPayload {
  stop: string;
  arrival_offset_minutes: number;
  departure_offset_minutes: number;
  is_boarding_point: boolean;
  is_dropoff_point: boolean;
}

export interface RoutePayload {
  name: string;
  route_number: string;
  description: string;
  base_fare: string | null;
  active: boolean;
  stops: RouteStopPayload[];
}

// ---------------------------------------------------------------------------
// Trips & schedules. Datetimes are ISO strings; Sri Lanka is always UTC+05:30.
// ---------------------------------------------------------------------------
export type TripStatus = "scheduled" | "boarding" | "departed" | "completed" | "cancelled";

export interface RouteBrief {
  id: string;
  name: string;
  route_number: string;
  origin: StopBrief;
  destination: StopBrief;
  base_fare: string | null;
  active: boolean;
}

export interface BusBrief {
  id: string;
  name: string;
  registration_number: string;
  bus_type: BusType;
  seat_capacity: number;
  seat_layout: string | null;
  seat_layout_name: string | null;
  facilities: BusFacility[];
  active: boolean;
}

export interface AdminTripStop {
  sequence: number;
  stop: StopBrief;
  arrival_datetime: string;
  departure_datetime: string;
  is_boarding_point: boolean;
  is_dropoff_point: boolean;
}

export interface AdminTrip {
  id: string;
  code: string;
  route: string;
  route_summary: RouteBrief;
  bus: string;
  bus_summary: BusBrief;
  operator: string;
  operator_name: string;
  schedule: string | null;
  departure_datetime: string;
  estimated_arrival_datetime: string;
  status: TripStatus;
  base_price: string;
  active: boolean;
  booking_count: number;
  booked_seats: number;
  available_seats: number;
  created_at: string;
  updated_at: string;
}

export interface AdminTripDetail extends AdminTrip {
  stops: AdminTripStop[];
  cancellation_reason: string;
  cancelled_at: string | null;
}

export interface TripStopPayload {
  sequence: number;
  arrival_datetime: string;
  departure_datetime: string;
}

export interface TripPayload {
  route: string;
  bus: string;
  departure_datetime: string;
  /** Omit to use the route's standard fare (new trips only). */
  base_price?: string;
  active: boolean;
  /** Omit to take the times from the route (or shift the trip's current times). */
  stops?: TripStopPayload[];
}

export type Recurrence = "daily" | "weekly";

export interface AdminTripSchedule {
  id: string;
  route: string;
  route_summary: RouteBrief;
  bus: string;
  bus_summary: BusBrief;
  operator: string;
  operator_name: string;
  /** "20:30:00" */
  departure_time: string;
  base_price: string;
  recurrence: Recurrence;
  /** 0 = Monday … 6 = Sunday */
  weekdays: number[];
  start_date: string;
  end_date: string | null;
  active: boolean;
  last_generated_until: string | null;
  trip_count: number;
  upcoming_trip_count: number;
  duration_minutes: number | null;
  created_at: string;
  updated_at: string;
}

export interface TripSchedulePayload {
  route: string;
  bus: string;
  departure_time: string;
  base_price?: string;
  recurrence: Recurrence;
  weekdays: number[];
  start_date: string;
  end_date: string | null;
  active: boolean;
}

export interface GenerateTripsPayload {
  from_date: string;
  to_date: string;
  dry_run: boolean;
}

export type OccurrenceResult = "created" | "planned" | "exists" | "conflict" | "past";

export interface TripOccurrence {
  date: string;
  departure_datetime: string;
  arrival_datetime: string;
  result: OccurrenceResult;
  detail: string;
  trip_id: string | null;
}

export interface GenerateTripsResult {
  from_date: string;
  to_date: string;
  dry_run: boolean;
  created: number;
  planned: number;
  skipped: number;
  occurrences: TripOccurrence[];
}

export type ActivityAction =
  | "created"
  | "updated"
  | "deleted"
  | "activated"
  | "deactivated"
  | "cancelled"
  | "status_changed"
  | "generated"
  | "refunded";

export interface ActivityEntry {
  id: string;
  actor_email: string;
  action: ActivityAction;
  entity_type: string;
  entity_id: string;
  entity_label: string;
  changes: {
    fields?: string[];
    from?: string;
    to?: string;
    reason?: string;
    created?: number;
    from_date?: string;
    to_date?: string;
    /** Refunds: the total refunded so far. */
    amount?: string;
    status?: string;
  };
  created_at: string;
}

export interface DashboardSummary {
  buses: { total: number; active: number };
  routes: { total: number; active: number };
  stops: { total: number; active: number };
  seat_layouts: { total: number; active: number };
  operators: { total: number; active: number; pending: number; suspended: number };
  upcoming_trips: {
    total: number;
    next_7_days: number;
    next: {
      id: string;
      code: string;
      route_name: string;
      bus_registration: string;
      operator_name: string;
      departure_datetime: string;
      active: boolean;
    }[];
  };
  recent_activity: ActivityEntry[];
}
