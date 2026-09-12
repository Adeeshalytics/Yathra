/**
 * Payment-flow helpers for the browser. The browser only hands the customer to the gateway and
 * shows what the server says; the server alone decides whether a payment succeeded.
 */
import type { CheckoutSession, CustomerPayment } from "@/lib/api/payment-types";

/** Browser navigation, wrapped so tests can stand in for it. */
export const browser = {
  assign: (url: string) => window.location.assign(url),
  submit: (form: HTMLFormElement) => form.submit(),
};

function checkedUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("The payment gateway address isn't a web address.");
  }
  return parsed.toString();
}

/**
 * Send the customer to the gateway's hosted checkout. Card and wallet details are typed on the
 * gateway's own page — never on ours.
 */
export function goToCheckout(checkout: CheckoutSession): void {
  if (checkout.method === "redirect") {
    browser.assign(checkedUrl(checkout.url));
    return;
  }
  if (checkout.method === "post") {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = checkedUrl(checkout.url);
    form.hidden = true;
    for (const [name, value] of Object.entries(checkout.fields)) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      form.appendChild(input);
    }
    document.body.appendChild(form);
    browser.submit(form);
  }
}

export type PaymentPhase =
  | "verifying"
  | "paid"
  | "failed"
  | "cancelled"
  | "refund_due"
  | "refunded"
  | "expired";

/** What the payment page should say, from the server's view of the payment and its booking. */
export function paymentPhase(payment: CustomerPayment): PaymentPhase {
  const booked = payment.booking_status === "confirmed" || payment.booking_status === "completed";
  if (payment.requires_refund) return "refund_due";
  switch (payment.status) {
    case "successful":
    case "partially_refunded":
      return booked ? "paid" : "verifying";
    case "refunded":
      return "refunded";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return payment.booking_status === "expired" || payment.booking_status === "cancelled"
        ? "expired"
        : "verifying";
  }
}

/** True while the customer can still pay for the booking. */
export function canRetryPayment(booking: { status: string; seconds_remaining: number | null }): boolean {
  return (
    (booking.status === "pending" || booking.status === "payment_pending") &&
    (booking.seconds_remaining ?? 0) > 0
  );
}

/** Save a downloaded file (e.g. the PDF ticket) under `filename`. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
