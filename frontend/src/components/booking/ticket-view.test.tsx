import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/errors";

import { TICKET } from "./fixtures";
import { TicketView } from "./ticket-view";

const api = vi.hoisted(() => ({ ticket: vi.fn(), ticketPdf: vi.fn() }));
const save = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/endpoints", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/endpoints")>()),
  bookingsApi: api,
}));
vi.mock("@/lib/payment", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payment")>()),
  saveBlob: save,
}));

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TicketView id="booking-1" />
    </QueryClientProvider>,
  );
}

describe("TicketView", () => {
  beforeEach(() => {
    [api.ticket, api.ticketPdf, save].forEach((fn) => fn.mockReset());
  });
  afterEach(() => vi.restoreAllMocks());

  it("shows everything a conductor needs, with the QR code", async () => {
    api.ticket.mockResolvedValue(TICKET);
    renderView();

    expect(await screen.findByRole("heading", { name: "Colombo – Batticaloa" })).toBeInTheDocument();
    expect(screen.getByText("YTABC23456")).toBeInTheDocument();
    expect(screen.getByText("Valid")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "QR code for ticket TKZB6WDYRJRZ" })).toHaveAttribute(
      "src",
      TICKET.qr_code,
    );
    expect(screen.getByText("Colombo Fort")).toBeInTheDocument();
    expect(screen.getByText("WP NC-4521")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Dilan Fernando" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "16" })).toBeInTheDocument();
    expect(screen.getByText("LKR 5,150")).toBeInTheDocument();
  });

  it("downloads the PDF with the signed-in session", async () => {
    const user = userEvent.setup();
    const pdf = new Blob(["%PDF-1.4"], { type: "application/pdf" });
    api.ticket.mockResolvedValue(TICKET);
    api.ticketPdf.mockResolvedValue(pdf);
    renderView();

    await user.click(await screen.findByRole("button", { name: "Download PDF" }));

    expect(api.ticketPdf).toHaveBeenCalledWith("booking-1");
    expect(save).toHaveBeenCalledWith(pdf, expect.stringMatching(/-ticket-YTABC23456\.pdf$/));
  });

  it("prints the ticket", async () => {
    const user = userEvent.setup();
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    api.ticket.mockResolvedValue(TICKET);
    renderView();

    await user.click(await screen.findByRole("button", { name: "Print" }));

    expect(print).toHaveBeenCalled();
  });

  it("warns when the ticket can't be used", async () => {
    api.ticket.mockResolvedValue({ ...TICKET, status: "cancelled", status_label: "Cancelled", is_valid: false });
    renderView();

    expect(await screen.findByText(/This ticket is cancelled and can’t be used for travel/)).toBeInTheDocument();
  });

  it("explains that tickets come after payment", async () => {
    api.ticket.mockRejectedValue(
      new ApiError({
        status: 404,
        code: "ticket_not_issued",
        message: "Your e-ticket is issued as soon as your payment is confirmed.",
      }),
    );
    renderView();

    expect(await screen.findByText("Your e-ticket isn’t ready yet")).toBeInTheDocument();
    expect(screen.getByText("Your e-ticket is issued as soon as your payment is confirmed.")).toBeInTheDocument();
  });
});
