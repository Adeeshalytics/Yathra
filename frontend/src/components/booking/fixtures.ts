/** Sample API data for booking, payment and ticket component tests. */
import type { CancellationQuote, CustomerBooking } from "@/lib/api/booking-types";
import type { CustomerPayment, CustomerTicket } from "@/lib/api/payment-types";

const stop = (id: string, name: string, city = name) => ({
  id,
  name,
  city,
  latitude: null,
  longitude: null,
});

/** Nothing paid yet, so cancelling just releases the seats. */
export const CANCELLATION: CancellationQuote = {
  allowed: true,
  code: "",
  message: "No payment has been taken, so cancelling only releases your seats.",
  refundable: false,
  refund_amount: "0.00",
  refund_percent: "0",
  fee: "0.00",
  paid_amount: "0.00",
  currency: "LKR",
  hours_before_departure: 120,
  deadline: "2030-09-15T14:30:00+05:30",
};

export const BOOKING: CustomerBooking = {
  id: "booking-1",
  booking_reference: "YTABC23456",
  status: "payment_pending",
  status_label: "Payment pending",
  customer: { id: "user-1", name: "Kasuni Fernando", email: "kasuni@example.com", phone: "+94771234567" },
  trip: {
    id: "trip-1",
    code: "TR7KQ2M9",
    status: "scheduled",
    route: {
      id: "route-1",
      name: "Colombo – Batticaloa",
      route_number: "",
      origin: stop("a", "Colombo Fort", "Colombo"),
      destination: stop("e", "Batticaloa"),
      road_path: null,
    },
    operator: { id: "operator-1", name: "Ceylon Coach Services" },
    bus: {
      name: "Batticaloa Night Express",
      registration_number: "WP NC-4521",
      bus_type: "super_luxury",
      bus_type_label: "Super Luxury",
    },
    departure_datetime: "2030-09-15T20:30:00+05:30",
    arrival_datetime: "2030-09-16T05:30:00+05:30",
  },
  boarding: { stop: stop("a", "Colombo Fort", "Colombo"), time: "2030-09-15T20:30:00+05:30" },
  dropoff: { stop: stop("e", "Batticaloa"), time: "2030-09-16T05:30:00+05:30" },
  seats: ["15", "16"],
  passengers: [
    { id: "p1", seat_number: "15", name: "Kasuni Fernando", phone: "+94771234567", email: "kasuni@example.com" },
    { id: "p2", seat_number: "16", name: "Dilan Fernando", phone: "+94771234568", email: "dilan@example.com" },
  ],
  price: {
    currency: "LKR",
    unit_price: "2500.00",
    seats: 2,
    subtotal: "5000.00",
    service_fee: "150.00",
    discount: "0.00",
    tax: "0.00",
    total: "5150.00",
  },
  total_amount: "5150.00",
  currency: "LKR",
  expires_at: "2030-09-10T10:10:00+05:30",
  seconds_remaining: 480,
  ticket: null,
  payment: null,
  cancellation: CANCELLATION,
  refunds: [],
  confirmed_at: null,
  cancelled_at: null,
  cancellation_reason: "",
  created_at: "2030-09-10T10:00:00+05:30",
  updated_at: "2030-09-10T10:00:00+05:30",
};

export const PAYMENT: CustomerPayment = {
  id: "5f0c7a9e-1111-4a4a-9b9b-222222222222",
  transaction_reference: "TXN0123456789ABCDEF01",
  booking: "booking-1",
  booking_reference: "YTABC23456",
  booking_status: "payment_pending",
  provider: "mock",
  provider_name: "Test card payment",
  status: "pending",
  status_label: "Pending",
  payment_method: "",
  payment_method_label: "",
  amount: "5150.00",
  currency: "LKR",
  refunded_amount: "0.00",
  requires_refund: false,
  failure_reason: "",
  created_at: "2030-09-10T10:02:00+05:30",
  paid_at: null,
  refunded_at: null,
};

export const CONFIRMED_BOOKING: CustomerBooking = {
  ...BOOKING,
  status: "confirmed",
  status_label: "Confirmed",
  seconds_remaining: null,
  cancellation: {
    ...CANCELLATION,
    message: "Cancelling now refunds LKR 5,150.00 of the LKR 5,150.00 you paid.",
    refundable: true,
    refund_amount: "5150.00",
    refund_percent: "100",
    paid_amount: "5150.00",
  },
  ticket: { ticket_number: "TKZB6WDYRJRZ", status: "valid", issued_at: "2030-09-10T10:03:00+05:30" },
  confirmed_at: "2030-09-10T10:03:00+05:30",
};

export const TICKET: CustomerTicket = {
  ticket_number: "TKZB6WDYRJRZ",
  status: "valid",
  status_label: "Valid",
  is_valid: true,
  issued_at: "2030-09-10T10:03:00+05:30",
  share_url: "http://localhost:3000/t/AbCdEfGhIjKlMnOpQrStUv",
  qr_code: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=",
  booking: CONFIRMED_BOOKING,
  payment: {
    transaction_reference: "TXN0123456789ABCDEF01",
    provider_name: "Test card payment",
    payment_method_label: "Card",
    amount: "5150.00",
    currency: "LKR",
    paid_at: "2030-09-10T10:03:00+05:30",
  },
};
