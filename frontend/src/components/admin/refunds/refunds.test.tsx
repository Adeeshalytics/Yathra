import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminRefund } from "@/lib/api/payment-types";

import { RefundsList } from "./refunds-list";

const api = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), setStatus: vi.fn() }));

vi.mock("@/lib/api/admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/admin")>();
  return { ...actual, adminApi: { ...actual.adminApi, refunds: api } };
});

const REFUND: AdminRefund = {
  id: "refund-1",
  reference: "RF7K2M9XHA",
  booking: "booking-1",
  booking_reference: "YTABC23456",
  amount: "2500.00",
  currency: "LKR",
  status: "requested",
  status_label: "Requested",
  reason: "Plans changed",
  resolution: "",
  created_at: "2030-09-10T10:30:00+05:30",
  resolved_at: null,
  customer: { id: "user-1", name: "Kasuni Fernando", email: "kasuni@example.com", phone: "+94771234567" },
  trip: {
    id: "trip-1",
    code: "TR7KQ2M9",
    route: "Colombo – Batticaloa",
    departure_datetime: "2030-09-15T20:30:00+05:30",
  },
  payment: {
    id: "pay-1",
    transaction_reference: "TXN0123456789ABCDEF01",
    provider: "mock",
    provider_name: "Test card payment",
    status: "successful",
    refundable_amount: "2500.00",
    refund_through_gateway: true,
  },
  breakdown: { refund_percent: "100", paid_amount: "2500.00" },
  requested_by: "kasuni@example.com",
  resolved_by: "",
  updated_at: "2030-09-10T10:30:00+05:30",
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("Admin refunds", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    api.list.mockResolvedValue({ count: 1, total_pages: 1, results: [REFUND] });
    api.setStatus.mockResolvedValue({ ...REFUND, status: "completed", status_label: "Completed" });
  });

  it("lists what the platform owes and to whom", async () => {
    render(<RefundsList />, { wrapper });

    // The table shell renders while loading, so wait for a row before reading it.
    await screen.findByText("RF7K2M9XHA");
    const table = screen.getByRole("table", { name: "Refunds" });
    expect(within(table).getByText("RF7K2M9XHA")).toBeInTheDocument();
    expect(within(table).getByText("YTABC23456")).toBeInTheDocument();
    expect(within(table).getByText("Kasuni Fernando")).toBeInTheDocument();
    expect(within(table).getByText("LKR 2,500")).toBeInTheDocument();
    expect(within(table).getByText("Requested")).toBeInTheDocument();
    expect(api.list).toHaveBeenCalledWith({ page: 1 }, expect.anything());
  });

  it("moves a request to processing", async () => {
    const person = userEvent.setup();
    render(<RefundsList />, { wrapper });

    await person.click(await screen.findByRole("button", { name: "Manage" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Plans changed/)).toBeInTheDocument();
    await person.click(within(dialog).getByRole("button", { name: "Mark as processing" }));

    expect(api.setStatus).toHaveBeenCalledWith("refund-1", {
      status: "processing",
      note: "",
      external: false,
    });
  });

  it("completes a refund with a note", async () => {
    const person = userEvent.setup();
    render(<RefundsList />, { wrapper });

    await person.click(await screen.findByRole("button", { name: "Manage" }));
    const dialog = await screen.findByRole("dialog");
    await person.type(within(dialog).getByLabelText(/Note/), "Sent back to the card");
    await person.click(within(dialog).getByRole("button", { name: /Complete LKR\s*2,500/ }));

    expect(api.setStatus).toHaveBeenCalledWith("refund-1", {
      status: "completed",
      note: "Sent back to the card",
      external: false,
    });
  });

  it("rejects a request", async () => {
    const person = userEvent.setup();
    render(<RefundsList />, { wrapper });

    await person.click(await screen.findByRole("button", { name: "Manage" }));
    const dialog = await screen.findByRole("dialog");
    await person.type(within(dialog).getByLabelText(/Note/), "Outside the policy");
    await person.click(within(dialog).getByRole("button", { name: "Reject" }));

    expect(api.setStatus).toHaveBeenCalledWith("refund-1", {
      status: "rejected",
      note: "Outside the policy",
      external: false,
    });
  });

  it("records refunds made in the gateway's own portal", async () => {
    const person = userEvent.setup();
    api.list.mockResolvedValue({
      count: 1,
      total_pages: 1,
      results: [
        {
          ...REFUND,
          payment: { ...REFUND.payment!, provider_name: "PayHere", refund_through_gateway: false },
        },
      ],
    });
    render(<RefundsList />, { wrapper });

    await person.click(await screen.findByRole("button", { name: "Manage" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/PayHere refunds are made in its own portal/)).toBeInTheDocument();
    await person.click(within(dialog).getByRole("button", { name: /Complete/ }));

    expect(api.setStatus).toHaveBeenCalledWith("refund-1", {
      status: "completed",
      note: "",
      external: true,
    });
  });

  it("shows when a resolved refund was settled instead of offering actions", async () => {
    api.list.mockResolvedValue({
      count: 1,
      total_pages: 1,
      results: [
        { ...REFUND, status: "completed", status_label: "Completed", resolved_at: "2030-09-11T09:00:00+05:30" },
      ],
    });
    render(<RefundsList />, { wrapper });

    expect(await screen.findByText("Completed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Manage" })).not.toBeInTheDocument();
  });
});
