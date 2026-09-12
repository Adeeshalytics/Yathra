/** Types for payments (/api/v1/payments), e-tickets and the admin payments API. */

import type { BookingStatus, CustomerBooking } from "./booking-types";

export type PaymentStatus =
  | "pending"
  | "processing"
  | "successful"
  | "failed"
  | "cancelled"
  | "refunded"
  | "partially_refunded";

export type PaymentMethod = "card" | "bank_transfer" | "mobile_wallet" | "cash" | "";

export interface PaymentProviderInfo {
  code: string;
  name: string;
  description: string;
  /** Sandbox / test gateway: no real money moves. */
  test_mode: boolean;
}

export interface PaymentProvidersResponse {
  default: string;
  providers: PaymentProviderInfo[];
}

export interface CustomerPayment {
  id: string;
  transaction_reference: string;
  booking: string;
  booking_reference: string;
  booking_status: BookingStatus;
  provider: string;
  provider_name: string;
  status: PaymentStatus;
  status_label: string;
  payment_method: PaymentMethod;
  payment_method_label: string;
  amount: string;
  currency: string;
  refunded_amount: string;
  /** Money was taken but the booking couldn't be honoured: it will be refunded. */
  requires_refund: boolean;
  failure_reason: string;
  created_at: string;
  paid_at: string | null;
  refunded_at: string | null;
}

/**
 * How to reach the gateway's hosted checkout: open `url` ("redirect"), or post `fields` to it
 * as a form ("post"). "none": nothing to pay, the booking is already confirmed.
 */
export interface CheckoutSession {
  method: "redirect" | "post" | "none";
  url: string;
  fields: Record<string, string>;
}

export interface StartPaymentResponse {
  payment: CustomerPayment | null;
  checkout: CheckoutSession;
}

/** A refund request works through this queue: requested → processing → completed or rejected. */
export type RefundStatus = "requested" | "processing" | "completed" | "rejected";

export interface CustomerRefund {
  id: string;
  reference: string;
  booking: string;
  booking_reference: string;
  amount: string;
  currency: string;
  status: RefundStatus;
  status_label: string;
  /** Why it was asked for (the cancellation reason). */
  reason: string;
  /** What the team decided, once resolved. */
  resolution: string;
  created_at: string;
  resolved_at: string | null;
}

export interface AdminRefund extends CustomerRefund {
  customer: { id: string; name: string; email: string };
  trip: { id: string; code: string; route: string; departure_datetime: string };
  payment: {
    id: string;
    transaction_reference: string;
    provider: string;
    provider_name: string;
    status: PaymentStatus;
    refundable_amount: string;
    refund_through_gateway: boolean;
  } | null;
  breakdown: Record<string, string | number | null>;
  requested_by: string;
  resolved_by: string;
  updated_at: string;
}

export interface RefundStatusPayload {
  status: RefundStatus;
  note?: string;
  /** Completing only: the money was returned outside the gateway's API. */
  external?: boolean;
}

export type TicketStatus = "valid" | "used" | "cancelled";

export interface CustomerTicket {
  ticket_number: string;
  status: TicketStatus;
  status_label: string;
  is_valid: boolean;
  issued_at: string;
  /** data: URI of an SVG QR code holding only the signed ticket number. */
  qr_code: string;
  booking: CustomerBooking;
  payment: {
    transaction_reference: string;
    provider_name: string;
    payment_method_label: string;
    amount: string;
    currency: string;
    paid_at: string;
  } | null;
}

export type PaymentEventOutcome = "applied" | "ignored" | "rejected";

export interface PaymentEvent {
  id: number;
  source: string;
  source_label: string;
  event_id: string;
  status: string;
  outcome: PaymentEventOutcome;
  outcome_label: string;
  message: string;
  data: Record<string, unknown>;
  created_at: string;
}

export interface AdminPayment extends CustomerPayment {
  provider_reference: string;
  customer: { id: string; name: string; email: string };
  trip: { id: string; code: string; route: string; departure_datetime: string };
  refundable_amount: string;
  /** The gateway can refund through its API; otherwise refunds are recorded after the fact. */
  refund_through_gateway: boolean;
  expires_at: string | null;
  updated_at: string;
}

export interface AdminPaymentDetail extends AdminPayment {
  provider_data: Record<string, unknown>;
  booking_detail: {
    id: string;
    booking_reference: string;
    status: BookingStatus;
    status_label: string;
    total_amount: string;
    currency: string;
    seats: string[];
  };
  events: PaymentEvent[];
}

export interface PaymentSummary {
  currency: string;
  collected_today: string;
  collected_30_days: string;
  refunded_total: string;
  needs_refund: number;
  open: number;
  by_status: Record<PaymentStatus, number>;
}

export interface RefundPayload {
  /** Omit (or null) to refund everything not yet refunded. */
  amount?: string | null;
  reason: string;
  /** The money was already returned outside the gateway's API (its portal, cash). */
  external: boolean;
}
