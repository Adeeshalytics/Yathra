import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MANIFEST, PASSENGER_ROW } from "@/components/admin/reports/fixtures";

const passengers = vi.hoisted(() => ({ list: vi.fn(), setBoarding: vi.fn() }));
const trips = vi.hoisted(() => ({ manifest: vi.fn(), manifestPdf: vi.fn(), list: vi.fn() }));
const routes = vi.hoisted(() => ({ list: vi.fn() }));
const buses = vi.hoisted(() => ({ list: vi.fn() }));
const save = vi.hoisted(() => vi.fn());
const search = vi.hoisted(() => ({ params: new URLSearchParams() }));

vi.mock("@/lib/api/admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/admin")>();
  return {
    ...actual,
    adminApi: {
      ...actual.adminApi,
      passengers,
      routes: { ...actual.adminApi.routes, ...routes },
      buses: { ...actual.adminApi.buses, ...buses },
      trips: { ...actual.adminApi.trips, ...trips },
    },
  };
});
vi.mock("@/lib/payment", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payment")>();
  return { ...actual, saveBlob: save };
});
vi.mock("next/navigation", () => ({ useSearchParams: () => search.params }));

import { PassengersList } from "./passengers-list";
import { TripManifestView } from "./trip-manifest";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const EMPTY = { count: 0, page: 1, total_pages: 1, next: null, previous: null, results: [] };
const PAGE = { ...EMPTY, count: 1, results: [PASSENGER_ROW] };

describe("Admin passengers", () => {
  beforeEach(() => {
    [passengers.list, passengers.setBoarding, routes.list, buses.list, save].forEach((fn) =>
      fn.mockReset(),
    );
    search.params = new URLSearchParams();
    passengers.list.mockResolvedValue(PAGE);
    routes.list.mockResolvedValue({ ...EMPTY, results: [{ id: "route-1", name: "Colombo – Kandy" }] });
    buses.list.mockResolvedValue({
      ...EMPTY,
      results: [{ id: "bus-1", registration_number: "WP NC-4521", name: "Night Express" }],
    });
  });

  it("lists who is travelling with their seat, points and payment", async () => {
    render(<PassengersList />, { wrapper });

    // The table renders its loading skeleton first, so wait for a real row.
    await screen.findByText("Kasuni Fernando");
    const table = screen.getByRole("table", { name: "Passengers" });
    expect(within(table).getByText("+94771234567")).toBeInTheDocument();
    expect(within(table).getByText("YTABC23456")).toBeInTheDocument();
    expect(within(table).getByText("15")).toBeInTheDocument();
    expect(within(table).getByText("Colombo Fort")).toBeInTheDocument();
    expect(within(table).getByText("Batticaloa")).toBeInTheDocument();
    expect(within(table).getByText("successful")).toBeInTheDocument();
    expect(within(table).getByText("Expected")).toBeInTheDocument();
  });

  it("narrows the list by route, bus, boarding status and travel date", async () => {
    const user = userEvent.setup();
    render(<PassengersList />, { wrapper });
    await screen.findByRole("table", { name: "Passengers" });

    await user.click(screen.getByRole("combobox", { name: "Route" }));
    await user.click(await screen.findByRole("option", { name: "Colombo – Kandy" }));
    expect(passengers.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ route: "route-1" }),
      expect.anything(),
    );

    await user.type(screen.getByLabelText("Travelling on"), "2030-09-15");
    expect(passengers.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ date: "2030-09-15" }),
      expect.anything(),
    );

    await user.click(screen.getByRole("combobox", { name: "Boarding" }));
    await user.click(await screen.findByRole("option", { name: "Boarded" }));
    expect(passengers.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ boarding_status: "boarded" }),
      expect.anything(),
    );
  });

  it("pins the list to one trip when it is opened from a trip", async () => {
    search.params = new URLSearchParams("trip=trip-1");
    render(<PassengersList />, { wrapper });

    await screen.findByRole("table", { name: "Passengers" });
    expect(passengers.list).toHaveBeenCalledWith(
      expect.objectContaining({ trip: "trip-1" }),
      expect.anything(),
    );
    expect(screen.getByRole("link", { name: "Show all passengers" })).toHaveAttribute(
      "href",
      "/admin/passengers",
    );
  });

  it("marks a passenger aboard", async () => {
    const user = userEvent.setup();
    passengers.setBoarding.mockResolvedValue({ ...PASSENGER_ROW, boarding_status: "boarded" });
    render(<PassengersList />, { wrapper });

    await user.click(
      await screen.findByRole("checkbox", { name: "Mark Kasuni Fernando on seat 15 as boarded" }),
    );

    expect(passengers.setBoarding).toHaveBeenCalledWith("passenger-1", true);
  });

  it("cannot board someone whose seat was released", async () => {
    passengers.list.mockResolvedValue({
      ...PAGE,
      results: [{ ...PASSENGER_ROW, boarding_status: "released" }],
    });
    render(<PassengersList />, { wrapper });

    expect(await screen.findByText("Not travelling")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});

describe("Trip manifest", () => {
  beforeEach(() => {
    [trips.manifest, trips.manifestPdf, save].forEach((fn) => fn.mockReset());
    trips.manifest.mockResolvedValue(MANIFEST);
  });

  it("heads the page with the journey and the seat count", async () => {
    render(<TripManifestView tripId="trip-1" />, { wrapper });

    expect(
      await screen.findByRole("heading", { name: "Colombo → Batticaloa" }),
    ).toBeInTheDocument();
    expect(screen.getByText("15 Sep 2030 · 8:30 PM")).toBeInTheDocument();
    expect(
      screen.getByText(/Trip TR7KQ2M9 · Bus WP NC-4521 \(Batticaloa Night Express\)/),
    ).toBeInTheDocument();
    expect(screen.getByText(/2 of 41 seats sold \(4.9%\)/)).toBeInTheDocument();
  });

  it("prints the passengers in seat order with their boarding state", async () => {
    render(<TripManifestView tripId="trip-1" />, { wrapper });

    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getByText("15")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Boarded")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Expected")).toBeInTheDocument();
  });

  it("downloads the PDF the server renders", async () => {
    const user = userEvent.setup();
    trips.manifestPdf.mockResolvedValue({
      blob: new Blob(["%PDF-"]),
      filename: "yathra-manifest-TR7KQ2M9.pdf",
    });
    render(<TripManifestView tripId="trip-1" />, { wrapper });

    await user.click(await screen.findByRole("button", { name: "Download PDF" }));

    expect(trips.manifestPdf).toHaveBeenCalledWith("trip-1", "TR7KQ2M9");
    expect(save).toHaveBeenCalledWith(expect.any(Blob), "yathra-manifest-TR7KQ2M9.pdf");
  });

  it("says so when nobody has booked yet", async () => {
    trips.manifest.mockResolvedValue({ ...MANIFEST, passengers: [] });
    render(<TripManifestView tripId="trip-1" />, { wrapper });

    expect(
      await screen.findByText("Nobody has booked a seat on this trip yet."),
    ).toBeInTheDocument();
  });
});
