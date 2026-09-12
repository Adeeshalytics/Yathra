import { afterEach, describe, expect, it, vi } from "vitest";

import { BOOKING, PAYMENT } from "@/components/booking/fixtures";
import type { CustomerPayment } from "@/lib/api/payment-types";

import { browser, canRetryPayment, goToCheckout, paymentPhase } from "./payment";

const phase = (overrides: Partial<CustomerPayment>) => paymentPhase({ ...PAYMENT, ...overrides });

describe("paymentPhase", () => {
  it("waits while the gateway hasn't confirmed anything", () => {
    expect(phase({ status: "pending" })).toBe("verifying");
    expect(phase({ status: "processing" })).toBe("verifying");
    // Paid, but the booking isn't confirmed yet in this response: keep polling.
    expect(phase({ status: "successful", booking_status: "payment_pending" })).toBe("verifying");
  });

  it("reads the server's verdict", () => {
    expect(phase({ status: "successful", booking_status: "confirmed" })).toBe("paid");
    expect(phase({ status: "failed" })).toBe("failed");
    expect(phase({ status: "cancelled" })).toBe("cancelled");
    expect(phase({ status: "refunded", booking_status: "cancelled" })).toBe("refunded");
    expect(phase({ status: "pending", booking_status: "expired" })).toBe("expired");
  });

  it("puts money that must be returned first", () => {
    expect(phase({ status: "successful", booking_status: "expired", requires_refund: true })).toBe("refund_due");
  });
});

describe("canRetryPayment", () => {
  it("allows paying while the hold lasts", () => {
    expect(canRetryPayment(BOOKING)).toBe(true);
    expect(canRetryPayment({ ...BOOKING, seconds_remaining: 0 })).toBe(false);
    expect(canRetryPayment({ ...BOOKING, status: "confirmed", seconds_remaining: null })).toBe(false);
  });
});

describe("goToCheckout", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("opens hosted checkout pages", () => {
    const assign = vi.spyOn(browser, "assign").mockImplementation(() => {});

    goToCheckout({ method: "redirect", url: "https://pay.example.lk/checkout?session=abc", fields: {} });

    expect(assign).toHaveBeenCalledWith("https://pay.example.lk/checkout?session=abc");
  });

  it("posts the gateway's signed form", () => {
    const submit = vi.spyOn(browser, "submit").mockImplementation(() => {});

    goToCheckout({
      method: "post",
      url: "https://sandbox.payhere.lk/pay/checkout",
      fields: { order_id: "TXN1", amount: "5150.00", hash: "ABC123" },
    });

    const form = submit.mock.calls[0][0];
    expect(form.method).toBe("post");
    expect(form.action).toBe("https://sandbox.payhere.lk/pay/checkout");
    expect(Object.fromEntries(new FormData(form))).toEqual({ order_id: "TXN1", amount: "5150.00", hash: "ABC123" });
  });

  it("refuses addresses that aren't web pages", () => {
    const assign = vi.spyOn(browser, "assign").mockImplementation(() => {});

    expect(() => goToCheckout({ method: "redirect", url: "ftp://example.lk/pay", fields: {} })).toThrow();
    expect(assign).not.toHaveBeenCalled();
  });

  it("does nothing when there's nothing to pay", () => {
    const assign = vi.spyOn(browser, "assign").mockImplementation(() => {});

    goToCheckout({ method: "none", url: "", fields: {} });

    expect(assign).not.toHaveBeenCalled();
  });
});
