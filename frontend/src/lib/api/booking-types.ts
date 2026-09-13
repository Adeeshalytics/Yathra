/** Types for bookings (/api/v1/bookings) and seat locks (/api/v1/seat-locks). */

import type { BusType } from "./admin-types";
import type { CustomerRefund, PaymentStatus, TicketStatus } from "./payment-types";
import type { PriceQuote, PublicRoute, PublicStop } from "./trip-types";
import type { TripStatus } from "./types";

/** The dashboard's tabs. The server decides what each one contains. */
export type BookingScope = "upcoming" | "past" | "cancelled";

export interface BookingSummary {
  upcoming: number;
  past: number;
  cancelled: number;
  total: number;
  spent: string;
  currency: string;
  open_refunds: number;
  next_departure: string | null;
}

/**
 * The server's answer to "can this be cancelled, and what comes back?". The cancellation policy
 * lives on the server — the browser only ever displays this.
 */
export interface CancellationQuote {
  allowed: boolean;
  code: string;
  message: string;
  refundable: boolean;
  refund_amount: string;
  refund_percent: string;
  fee: string;
  paid_amount: string;
  currency: string;
  hours_before_departure: number | null;
  deadline: string | null;
  /** The policy in words — only on GET /bookings/{id}/cancellation/. */
  rules?: string[];
}

export interface BookingPaymentSummary {
  id: string;
  status: PaymentStatus;
  status_label: string;
  provider: string;
  failure_reason: string;
  requires_refund: boolean;
  created_at: string;
}

export type BookingStatus =
  | "pending"
  | "payment_pending"
  | "confirmed"
  | "cancelled"
  | "expired"
  | "completed";

export interface BookingPassenger {
  id: string;
  seat_number: string;
  name: string;
  phone: string;
  email: string;
}

export interface BookingStop {
  stop: PublicStop;
  time: string | null;
}

export interface CustomerBooking {
  id: string;
  booking_reference: string;
  status: BookingStatus;
  status_label: string;
  customer: { id: string; name: string; email: string | null; phone: string };
  trip: {
    id: string;
    code: string;
    status: TripStatus;
    route: PublicRoute;
    operator: { id: string; name: string };
    bus: { name: string; registration_number: string; bus_type: BusType; bus_type_label: string };
    departure_datetime: string;
    arrival_datetime: string;
  };
  boarding: BookingStop | null;
  dropoff: BookingStop | null;
  seats: string[];
  passengers: BookingPassenger[];
  price: PriceQuote;
  total_amount: string;
  currency: string;
  /** When an unpaid booking's seat hold runs out. */
  expires_at: string | null;
  /** Seconds left on the hold (unpaid bookings only). */
  seconds_remaining: number | null;
  /** Issued when the payment is confirmed. */
  ticket: { ticket_number: string; status: TicketStatus; issued_at: string } | null;
  /** The latest payment attempt. */
  payment: BookingPaymentSummary | null;
  /** Whether it can be cancelled now, and what the policy would give back. */
  cancellation: CancellationQuote;
  refunds: CustomerRefund[];
  confirmed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string;
  created_at: string;
  updated_at: string;
}

export interface PassengerInput {
  seat_number: string;
  name: string;
  phone: string;
  email: string;
}

export interface CreateBookingPayload {
  trip: string;
  boarding_stop: string;
  dropoff_stop: string;
  passengers: PassengerInput[];
}
