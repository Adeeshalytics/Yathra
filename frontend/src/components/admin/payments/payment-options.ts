import type { PaymentStatus } from "@/lib/api/payment-types";

export const PAYMENT_STATUS_OPTIONS: { value: PaymentStatus; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "processing", label: "Processing" },
  { value: "successful", label: "Successful" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "refunded", label: "Refunded" },
  { value: "partially_refunded", label: "Partially refunded" },
];

export const PAYMENT_PROVIDER_OPTIONS = [
  { value: "payhere", label: "PayHere" },
  { value: "mock", label: "Test gateway" },
  { value: "manual", label: "Counter" },
];

export const REFUND_FILTER_OPTIONS = [
  { value: "true", label: "Needs refund" },
  { value: "false", label: "No refund due" },
];
