/** Filter options shared by the bookings and passengers screens. */

export const BOOKING_STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "payment_pending", label: "Awaiting payment" },
  { value: "confirmed", label: "Confirmed" },
  { value: "completed", label: "Travelled" },
  { value: "cancelled", label: "Cancelled" },
  { value: "expired", label: "Expired" },
];

export const BOOKING_PAYMENT_OPTIONS = [
  { value: "successful", label: "Paid" },
  { value: "pending", label: "Pending" },
  { value: "processing", label: "Processing" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "refunded", label: "Refunded" },
  { value: "partially_refunded", label: "Part refunded" },
];

export const BOARDING_STATUS_OPTIONS = [
  { value: "expected", label: "Expected" },
  { value: "boarded", label: "Boarded" },
  { value: "released", label: "No longer travelling" },
];

export const BOARDING_LABELS: Record<string, string> = {
  boarded: "Boarded",
  expected: "Expected",
  released: "Not travelling",
};
