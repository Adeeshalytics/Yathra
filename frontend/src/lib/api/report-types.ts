/** Types for the admin bookings, passengers, manifest, reports and dashboard charts APIs. */

import type { BookingStatus } from "./booking-types";
import type { PaymentStatus } from "./payment-types";

export interface AdminBookingRow {
  id: string;
  booking_reference: string;
  status: BookingStatus;
  status_label: string;
  customer: { id: string; name: string; email: string | null; phone: string };
  route_name: string;
  trip_code: string;
  trip: string;
  departure: string | null;
  seats: number;
  total_amount: string;
  paid_amount: string;
  currency: string;
  payment_status: PaymentStatus | null;
  created_at: string;
}

export type BoardingStatus = "boarded" | "expected" | "released";

export interface AdminPassengerRow {
  id: string;
  name: string;
  phone: string;
  seat_number: string;
  booking: string;
  booking_reference: string;
  booking_status: BookingStatus;
  payment_status: PaymentStatus | null;
  boarding_status: BoardingStatus;
  boarded_at: string | null;
  boarding_point: string;
  dropoff_point: string;
  trip: string;
  trip_code: string;
  route_name: string;
  bus_registration: string;
  departure: string | null;
}

export interface ManifestHeading {
  id: string;
  code: string;
  route_name: string;
  origin: string;
  destination: string;
  departure_datetime: string;
  departure_date: string;
  departure_time: string;
  bus_registration: string;
  bus_name: string;
  operator_name: string;
  status: string;
}

export interface ManifestCounts {
  capacity: number;
  passengers: number;
  boarded: number;
  empty_seats: number;
  occupancy: number;
}

/** One row of the printed manifest — the keys match `columns`. */
export type ManifestRow = Record<string, string | number | null>;

export interface TripManifest {
  trip: ManifestHeading;
  counts: ManifestCounts;
  columns: ReportColumn[];
  passengers: ManifestRow[];
  printed_at: string;
}

export type ReportKey =
  | "bookings"
  | "passengers"
  | "revenue"
  | "routes"
  | "occupancy"
  | "cancellations"
  | "payments";

export type RangeKey = "today" | "yesterday" | "week" | "month" | "custom" | "all";

export type ExportFormat = "csv" | "xlsx" | "pdf";

export type OccupancyGroup = "trip" | "route" | "bus" | "date";

export interface ReportColumn {
  key: string;
  header: string;
}

export interface DateRangeInfo {
  key: RangeKey;
  label: string;
  from_date: string | null;
  to_date: string | null;
}

export interface ReportCatalogue {
  reports: { key: ReportKey; title: string; description: string }[];
  ranges: { key: RangeKey; label: string }[];
  formats: ExportFormat[];
  occupancy_groups: OccupancyGroup[];
}

/** Every report row is flat: values are already formatted strings or plain numbers. */
export type ReportRow = Record<string, string | number | boolean | null>;

/** Totals differ per report, so the screen renders whatever the server sent. */
export type ReportSummary = Record<string, unknown>;

export interface ReportResponse {
  key: ReportKey;
  title: string;
  range: DateRangeInfo;
  columns: ReportColumn[];
  summary: ReportSummary;
  count: number;
  page: number;
  total_pages: number;
  next: string | null;
  previous: string | null;
  results: ReportRow[];
}

export interface DailyBookings {
  date: string;
  bookings: number;
  seats: number;
}

export interface DailyRevenue {
  date: string;
  gross: string;
  refunds: string;
  net: string;
}

export interface DailyCancellations {
  date: string;
  cancellations: number;
}

export interface DailyOccupancy {
  date: string;
  occupancy: number;
  seats_sold: number;
  capacity: number;
}

export interface TopRoute {
  route_id: string;
  route_name: string;
  bookings: number;
  seats_sold: number;
  occupancy: number;
  net: string;
}

export interface DashboardCharts {
  range: DateRangeInfo;
  bookings: DailyBookings[];
  revenue: DailyRevenue[];
  cancellations: DailyCancellations[];
  occupancy: {
    summary: { trips: number; capacity: number; seats_sold: number; occupancy: number };
    by_date: DailyOccupancy[];
  };
  top_routes: TopRoute[];
  totals: {
    bookings: number;
    booking_value: string;
    gross_revenue: string;
    net_revenue: string;
    cancellations: number;
    occupancy: number;
    seats_sold: number;
    capacity: number;
  };
}
