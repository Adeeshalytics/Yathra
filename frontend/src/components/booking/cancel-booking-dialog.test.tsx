import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CancellationQuote } from "@/lib/api/booking-types";

import { CancelBookingDialog } from "./cancel-booking-dialog";
import { CONFIRMED_BOOKING } from "./fixtures";

const api = vi.hoisted(() => ({ cancellation: vi.fn(), cancel: vi.fn() }));

vi.mock("@/lib/api/endpoints", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/endpoints")>()),
  bookingsApi: api,
}));

const POLICY: CancellationQuote = {
  allowed: true,
  code: "",
  message: "Cancelling now refunds LKR 3,862.50 of the LKR 5,150.00 you paid.",
  refundable: true,
  refund_amount: "3862.50",
  refund_percent: "75",
  fee: "0.00",
  paid_amount: "5150.00",
  currency: "LKR",
  hours_before_departure: 30,
  deadline: "2030-09-15T14:30:00+05:30",
  rules: [
    "48 hours or more before departure: in full",
    "24 hours or more before departure: 75% back",
    "Less than 6 hours before departure, bookings can only be cancelled by our support team.",
  ],
};

const onClose = vi.fn();

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CancelBookingDialog booking={CONFIRMED_BOOKING} onClose={onClose} />
    </QueryClientProvider>,
  );
}

describe("CancelBookingDialog", () => {
  beforeEach(() => {
    [api.cancellation, api.cancel, onClose].forEach((fn) => fn.mockReset());
  });

  it("shows the refund and the policy the server sent", async () => {
    api.cancellation.mockResolvedValue(POLICY);
    renderDialog();

    expect(await screen.findByText("You paid")).toBeInTheDocument();
    expect(screen.getByText("LKR 5,150")).toBeInTheDocument();
    expect(screen.getByText("Refund (75%)")).toBeInTheDocument();
    expect(screen.getByText("LKR 3,862.5")).toBeInTheDocument();
    // Every rule shown is the server's wording, not the browser's.
    expect(screen.getByText("Our cancellation policy")).toBeInTheDocument();
    POLICY.rules?.forEach((rule) => expect(screen.getByText(rule)).toBeInTheDocument());
    expect(api.cancellation).toHaveBeenCalledWith("booking-1", expect.anything());
  });

  it("subtracts a cancellation fee when the policy charges one", async () => {
    api.cancellation.mockResolvedValue({
      ...POLICY,
      fee: "250.00",
      refund_amount: "3612.50",
      message: "Cancelling now refunds LKR 3,612.50 of the LKR 5,150.00 you paid.",
    });
    renderDialog();

    expect(await screen.findByText("Cancellation fee")).toBeInTheDocument();
    expect(screen.getByText("− LKR 250")).toBeInTheDocument();
  });

  it("cancels with the reason the customer gave", async () => {
    const person = userEvent.setup();
    api.cancellation.mockResolvedValue(POLICY);
    api.cancel.mockResolvedValue({ ...CONFIRMED_BOOKING, status: "cancelled", refunds: [] });
    renderDialog();

    await person.type(await screen.findByLabelText(/Reason/), "Family emergency");
    await person.click(screen.getByRole("button", { name: /Cancel and refund/ }));

    expect(api.cancel).toHaveBeenCalledWith("booking-1", "Family emergency");
    expect(onClose).toHaveBeenCalled();
  });

  it("refuses to cancel when the server says it is too late", async () => {
    api.cancellation.mockResolvedValue({
      ...POLICY,
      allowed: false,
      code: "cutoff",
      refundable: false,
      refund_amount: "0.00",
      message:
        "Bookings can only be cancelled up to 6 hours before departure. Please contact our support team.",
    });
    renderDialog();

    expect(await screen.findByText(/only be cancelled up to 6 hours/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel booking" })).toBeDisabled();
    expect(screen.queryByLabelText(/Reason/)).not.toBeInTheDocument();
  });

  it("keeps the booking when the customer backs out", async () => {
    const person = userEvent.setup();
    api.cancellation.mockResolvedValue(POLICY);
    renderDialog();

    await person.click(await screen.findByRole("button", { name: "Keep booking" }));

    expect(api.cancel).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
