/** The shared e-ticket link and the operator portal (/api/v1/tickets/shared, /api/v1/operator). */
import type { TripStatus } from "./admin-types";
import type { BookingStatus } from "./booking-types";
import type { PaymentStatus, TicketStatus } from "./payment-types";

export interface SharedTicketPoint {
  name: string;
  city: string;
  latitude: string | null;
  longitude: string | null;
  time: string | null;
}

/** What whoever holds a ticket link sees: the journey, and nothing private. */
export interface SharedTicket {
  ticket_number: string;
  status: TicketStatus;
  status_label: string;
  is_valid: boolean;
  issued_at: string;
  qr_code: string;
  booking_reference: string;
  trip: {
    code: string;
    status: TripStatus;
    route_name: string;
    operator_name: string;
    bus_name: string;
    bus_registration: string;
    bus_type_label: string;
    departure_datetime: string;
  };
  boarding: SharedTicketPoint | null;
  dropoff: SharedTicketPoint | null;
  passengers: { seat_number: string; name: string }[];
}

export type OperatorRole = "owner" | "manager" | "staff";

export interface OperatorTripRow {
  id: string;
  code: string;
  status: TripStatus;
  status_label: string;
  route_name: string;
  origin: string;
  destination: string;
  departure_datetime: string;
  arrival_datetime: string;
  bus_registration: string;
  bus_name: string;
  seats_sold: number;
  capacity: number;
  occupancy: number;
  boarded: number;
}

export interface OperatorTripStop {
  sequence: number;
  name: string;
  city: string;
  arrival_datetime: string | null;
  departure_datetime: string | null;
  is_boarding_point: boolean;
  is_dropoff_point: boolean;
}

export interface RevenueSummary {
  gross_revenue: string;
  refunds: string;
  net_revenue: string;
  bookings: number;
  payments: number;
  average_booking_value: string;
}

export interface OperatorTripDetail extends OperatorTripRow {
  base_price: string;
  cancellation_reason: string;
  stops: OperatorTripStop[];
  bookings: { confirmed: number; awaiting_payment: number; cancelled: number };
  /** Only for owners and managers. */
  revenue: RevenueSummary | null;
}

export interface OperatorDashboard {
  operator: { id: string; company_name: string; status: string };
  role: OperatorRole;
  can_see_revenue: boolean;
  today: {
    date: string;
    trips: number;
    cancelled_trips: number;
    capacity: number;
    passengers: number;
    boarded: number;
    occupancy: number;
    bookings_sold: number;
    seats_sold: number;
  };
  upcoming: { next_7_days: number; trips: OperatorTripRow[] };
  revenue: { today: RevenueSummary; month: RevenueSummary } | null;
}

export interface OperatorBookingRow {
  id: string;
  booking_reference: string;
  status: BookingStatus;
  status_label: string;
  customer: { name: string; phone: string };
  route_name: string;
  trip: string;
  trip_code: string;
  departure: string | null;
  seats: number;
  total_amount: string;
  paid_amount: string;
  currency: string;
  payment_status: PaymentStatus | null;
  created_at: string;
}

export interface OperatorBookingDetail extends OperatorBookingRow {
  confirmed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string;
  trip_details: {
    id: string;
    code: string;
    status: TripStatus;
    status_label: string;
    route_name: string;
    departure_datetime: string;
    bus_registration: string;
  };
  boarding: { name: string; time: string | null } | null;
  dropoff: { name: string; time: string | null } | null;
  passengers: {
    id: string;
    seat_number: string;
    name: string;
    phone: string;
    boarding_status: "boarded" | "expected" | "released";
    boarded_at: string | null;
  }[];
  ticket: { ticket_number: string; status: TicketStatus } | null;
  refunds: { amount: string; status: string; status_label: string; created_at: string }[];
}

export type OperatorReportKey = "revenue" | "routes";
