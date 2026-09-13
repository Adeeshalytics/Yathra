import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/errors";
import type { SharedTicket } from "@/lib/api/portal-types";

const tickets = vi.hoisted(() => ({ shared: vi.fn(), sharedPdf: vi.fn(), find: vi.fn() }));

vi.mock("@/lib/api/endpoints", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/endpoints")>();
  return { ...actual, ticketsApi: tickets };
});

import { FindBookingForm } from "./find-booking-form";
import { SharedTicketView } from "./shared-ticket-view";

const TICKET: SharedTicket = {
  ticket_number: "TK7KQ2M9XHAB",
  status: "valid",
  status_label: "Valid",
  is_valid: true,
  issued_at: "2030-09-10T10:00:00+05:30",
  qr_code: "data:image/svg+xml;base64,PHN2Zy8+",
  booking_reference: "YT7KQ2M9XH",
  trip: {
    code: "TR7KQ2M9",
    status: "scheduled",
    route_name: "Colombo – Kandy",
    operator_name: "Ceylon Coach Services",
    bus_name: "Hill Country Express",
    bus_registration: "WP NC-4521",
    bus_type_label: "Super Luxury",
    departure_datetime: "2030-09-15T20:30:00+05:30",
  },
  boarding: {
    name: "Pettah Central",
    city: "Colombo",
    latitude: null,
    longitude: null,
    time: "2030-09-15T20:30:00+05:30",
  },
  dropoff: { name: "Kandy Goods Shed", city: "Kandy", latitude: null, longitude: null, time: "2030-09-15T23:30:00+05:30" },
  passengers: [
    { seat_number: "15", name: "Kasuni Fernando" },
    { seat_number: "16", name: "Ravi Fernando" },
  ],
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("SharedTicketView", () => {
  beforeEach(() => Object.values(tickets).forEach((fn) => fn.mockReset()));

  it("shows the QR code and everything needed at the bus door", async () => {
    tickets.shared.mockResolvedValue(TICKET);
    render(<SharedTicketView code="AbCdEfGhIjKlMnOpQrStUv" />, { wrapper });

    expect(await screen.findByText("YT7KQ2M9XH")).toBeInTheDocument();
    expect(tickets.shared).toHaveBeenCalledWith("AbCdEfGhIjKlMnOpQrStUv", expect.anything());
    expect(screen.getByRole("img", { name: "QR code for ticket TK7KQ2M9XHAB" })).toBeInTheDocument();
    expect(screen.getByText("Pettah Central")).toBeInTheDocument();
    expect(screen.getByText("WP NC-4521")).toBeInTheDocument();
    expect(screen.getByText("Ravi Fernando")).toBeInTheDocument();
    expect(screen.getByText("Seat 16")).toBeInTheDocument();
  });

  it("warns when the ticket can no longer be used", async () => {
    tickets.shared.mockResolvedValue({ ...TICKET, status: "cancelled", status_label: "Cancelled", is_valid: false });
    render(<SharedTicketView code="AbCdEfGhIjKlMnOpQrStUv" />, { wrapper });

    expect(await screen.findByText("This ticket is cancelled and can’t be used for travel.")).toBeInTheDocument();
  });

  it("offers Find my booking for a link that doesn't work", async () => {
    tickets.shared.mockRejectedValue(new ApiError({ status: 404, code: "not_found", message: "Not found." }));
    render(<SharedTicketView code="broken" />, { wrapper });

    expect(await screen.findByText("This ticket link doesn’t work")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Find my booking" })).toHaveAttribute("href", "/find-booking");
  });
});

describe("FindBookingForm", () => {
  beforeEach(() => Object.values(tickets).forEach((fn) => fn.mockReset()));

  it("needs a reference and a valid phone number", async () => {
    const person = userEvent.setup();
    render(<FindBookingForm />, { wrapper });

    await person.type(screen.getByLabelText("Mobile number on the booking"), "12");
    await person.click(screen.getByRole("button", { name: "Text me my ticket" }));

    expect(await screen.findByText("Enter your booking reference, e.g. YT7KQ2M9XH.")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid phone number, e.g. 077 123 4567.")).toBeInTheDocument();
    expect(tickets.find).not.toHaveBeenCalled();
  });

  it("asks for the ticket to be texted and shows the server's answer", async () => {
    const person = userEvent.setup();
    tickets.find.mockResolvedValue({ detail: "If that booking reference and phone number match a paid booking, we’ve texted the ticket." });
    render(<FindBookingForm />, { wrapper });

    await person.type(screen.getByLabelText("Booking reference"), "yt7kq2m9xh");
    await person.type(screen.getByLabelText("Mobile number on the booking"), "077 123 4567");
    await person.click(screen.getByRole("button", { name: "Text me my ticket" }));

    await waitFor(() => expect(tickets.find).toHaveBeenCalledWith("yt7kq2m9xh", "077 123 4567"));
    expect(await screen.findByText("Check your messages")).toBeInTheDocument();
    expect(screen.getByText(/we’ve texted the ticket/)).toBeInTheDocument();
  });

  it("explains when texts can't be sent", async () => {
    const person = userEvent.setup();
    tickets.find.mockRejectedValue(
      new ApiError({
        status: 503,
        code: "sms_unavailable",
        message: "We can’t send text messages right now. Please contact our support team.",
      }),
    );
    render(<FindBookingForm />, { wrapper });

    await person.type(screen.getByLabelText("Booking reference"), "YT7KQ2M9XH");
    await person.type(screen.getByLabelText("Mobile number on the booking"), "077 123 4567");
    await person.click(screen.getByRole("button", { name: "Text me my ticket" }));

    expect(await screen.findByText("We can’t send text messages right now. Please contact our support team.")).toBeInTheDocument();
  });
});
