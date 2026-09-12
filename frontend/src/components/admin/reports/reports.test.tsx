import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CATALOGUE, BOOKING_REPORT, CHARTS } from "./fixtures";

const reports = vi.hoisted(() => ({
  catalogue: vi.fn(),
  run: vi.fn(),
  download: vi.fn(),
}));
const charts = vi.hoisted(() => vi.fn());
const save = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/admin")>();
  return { ...actual, adminApi: { ...actual.adminApi, reports, charts } };
});
vi.mock("@/lib/payment", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payment")>();
  return { ...actual, saveBlob: save };
});

import { TradingCharts } from "../dashboard/charts";

import { ReportsView } from "./reports-view";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("Admin reports", () => {
  beforeEach(() => {
    [reports.catalogue, reports.run, reports.download, charts, save].forEach((fn) => fn.mockReset());
    reports.catalogue.mockResolvedValue(CATALOGUE);
    reports.run.mockResolvedValue(BOOKING_REPORT);
  });

  it("runs the booking report for this month and shows the server's totals", async () => {
    render(<ReportsView />, { wrapper });

    expect(await screen.findByRole("heading", { name: "Booking report" })).toBeInTheDocument();
    expect(screen.getByText("This month · 2030-09-01 to 2030-09-30")).toBeInTheDocument();
    const totals = within(screen.getByRole("group", { name: "Report totals" }));
    expect(totals.getByText("Bookings")).toBeInTheDocument();
    expect(totals.getByText("Value")).toBeInTheDocument();
    expect(totals.getByText("LKR 8,700")).toBeInTheDocument();
    expect(totals.getByText("Average value")).toBeInTheDocument();

    const table = await screen.findByRole("table", { name: "Booking report" });
    expect(within(table).getByText("YTABC23456")).toBeInTheDocument();
    expect(within(table).getByText("LKR 5,000")).toBeInTheDocument();
    expect(reports.run).toHaveBeenCalledWith("bookings", { range: "month", page: 1 }, expect.anything());
  });

  it("asks the server for another report when one is picked", async () => {
    const user = userEvent.setup();
    render(<ReportsView />, { wrapper });
    await screen.findByRole("table", { name: "Booking report" });

    await user.click(screen.getByRole("combobox", { name: "Report" }));
    await user.click(await screen.findByRole("option", { name: "Revenue report" }));

    expect(reports.run).toHaveBeenCalledWith("revenue", { range: "month", page: 1 }, expect.anything());
  });

  it("sends custom dates only with a custom range", async () => {
    const user = userEvent.setup();
    render(<ReportsView />, { wrapper });
    await screen.findByRole("table", { name: "Booking report" });

    await user.click(screen.getByRole("combobox", { name: "Date range" }));
    await user.click(await screen.findByRole("option", { name: "Today" }));
    expect(reports.run).toHaveBeenLastCalledWith("bookings", { range: "today", page: 1 }, expect.anything());

    await user.click(screen.getByRole("combobox", { name: "Date range" }));
    await user.click(await screen.findByRole("option", { name: "Custom range" }));
    const from = await screen.findByLabelText("From date");
    await user.type(from, "2030-09-01");

    expect(reports.run).toHaveBeenLastCalledWith(
      "bookings",
      { range: "custom", date_from: "2030-09-01", page: 1 },
      expect.anything(),
    );
  });

  it("offers the occupancy grouping only for the occupancy report", async () => {
    const user = userEvent.setup();
    render(<ReportsView />, { wrapper });
    await screen.findByRole("table", { name: "Booking report" });
    expect(screen.queryByRole("combobox", { name: "Group" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Report" }));
    await user.click(await screen.findByRole("option", { name: "Bus occupancy report" }));

    expect(await screen.findByRole("combobox", { name: "Group" })).toBeInTheDocument();
    expect(reports.run).toHaveBeenLastCalledWith(
      "occupancy",
      { range: "month", page: 1, group_by: "trip" },
      expect.anything(),
    );
  });

  it("downloads the report as CSV, Excel or PDF without the page number", async () => {
    const user = userEvent.setup();
    reports.download.mockResolvedValue({ blob: new Blob(["a,b"]), filename: "yathra-bookings.csv" });
    render(<ReportsView />, { wrapper });
    await screen.findByRole("table", { name: "Booking report" });

    await user.click(screen.getByRole("button", { name: "CSV" }));

    expect(reports.download).toHaveBeenCalledWith("bookings", "csv", {
      range: "month",
      page: undefined,
    });
    expect(save).toHaveBeenCalledWith(expect.any(Blob), "yathra-bookings.csv");
    expect(screen.getByRole("button", { name: "Excel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "PDF" })).toBeInTheDocument();
  });

  it("says so when a period has nothing in it", async () => {
    reports.run.mockResolvedValue({ ...BOOKING_REPORT, count: 0, results: [] });
    render(<ReportsView />, { wrapper });

    expect(await screen.findByText("Nothing in this period")).toBeInTheDocument();
  });
});

describe("Dashboard charts", () => {
  beforeEach(() => {
    charts.mockReset();
    charts.mockResolvedValue(CHARTS);
  });

  it("draws every series from the aggregated response", async () => {
    render(<TradingCharts />, { wrapper });

    expect(await screen.findByText("Daily bookings")).toBeInTheDocument();
    expect(screen.getByText("Daily revenue")).toBeInTheDocument();
    expect(screen.getByText("Seats sold against capacity on the day each trip runs.")).toBeInTheDocument();
    expect(screen.getByText("Bookings cancelled each day.")).toBeInTheDocument();
    expect(screen.getByText("Top routes")).toBeInTheDocument();
    // Two days of data → two labelled points per chart.
    expect(screen.getAllByRole("img").length).toBeGreaterThanOrEqual(3);
    expect(charts).toHaveBeenCalledWith({ range: "month" }, expect.anything());
  });

  it("shows the period's totals and the best routes", async () => {
    render(<TradingCharts />, { wrapper });

    const totals = within(await screen.findByRole("group", { name: "Trading totals" }));
    expect(totals.getByText("Net revenue")).toBeInTheDocument();
    expect(totals.getByText("LKR 6,200")).toBeInTheDocument();
    expect(totals.getByText("3.7%")).toBeInTheDocument();
    expect(totals.getByText("3 of 82 seats")).toBeInTheDocument();
    expect(screen.getByText("Colombo – Batticaloa")).toBeInTheDocument();
    expect(screen.getByText("2 bookings · 2 seats · 4.9% full")).toBeInTheDocument();
  });

  it("re-reads the charts when the period changes", async () => {
    const user = userEvent.setup();
    render(<TradingCharts />, { wrapper });
    await screen.findByText("Daily bookings");

    await user.click(screen.getByRole("combobox", { name: "Date range" }));
    await user.click(await screen.findByRole("option", { name: "This week" }));

    expect(charts).toHaveBeenLastCalledWith({ range: "week" }, expect.anything());
  });
});
