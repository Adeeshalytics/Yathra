import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TripSearchResponse } from "@/lib/api/trip-types";

import { NIGHT_TRIP } from "./bus-card.test";
import { SearchExperience } from "./search-experience";

const navigation = vi.hoisted(() => ({
  params: new URLSearchParams(),
  replace: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace, push: navigation.push }),
  useSearchParams: () => navigation.params,
}));

const search = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/endpoints", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/endpoints")>()),
  tripsApi: { search },
}));

function response(overrides: Partial<TripSearchResponse> = {}): TripSearchResponse {
  return {
    count: 1,
    page: 1,
    total_pages: 1,
    next: null,
    previous: null,
    results: [NIGHT_TRIP],
    search: {
      from: { city: "Colombo", label: "Colombo", stop_id: null },
      to: { city: "Batticaloa", label: "Batticaloa", stop_id: null },
      date: "2030-09-15",
      passengers: 1,
      sort: "departure",
    },
    facets: {
      total: 1,
      operators: [{ id: "operator-1", name: "Ceylon Coach Services", count: 1 }],
      bus_types: [
        { value: "normal", label: "Normal", count: 0 },
        { value: "ac", label: "AC", count: 0 },
        { value: "luxury", label: "Luxury", count: 0 },
        { value: "super_luxury", label: "Super Luxury", count: 1 },
      ],
      departure_periods: [
        { value: "early_morning", label: "Before 6 AM", count: 0 },
        { value: "morning", label: "6 AM – 12 PM", count: 0 },
        { value: "afternoon", label: "12 PM – 6 PM", count: 0 },
        { value: "evening", label: "After 6 PM", count: 1 },
      ],
      ac: { ac: 1, non_ac: 0 },
      price: { min: "2500.00", max: "2500.00" },
    },
    route_exists: true,
    nearest_available_date: null,
    ...overrides,
  };
}

function renderAt(query: string) {
  navigation.params = new URLSearchParams(query);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SearchExperience />
    </QueryClientProvider>,
  );
}

const QUERY = "from=Colombo&to=Batticaloa&date=2030-09-15&passengers=1";

describe("SearchExperience", () => {
  beforeEach(() => {
    search.mockReset();
    navigation.replace.mockReset();
    navigation.push.mockReset();
  });

  it("lists the buses for the search", async () => {
    search.mockResolvedValue(response());
    renderAt(QUERY);

    expect(await screen.findByRole("heading", { name: "Batticaloa Night Express" })).toBeInTheDocument();
    expect(screen.getByText("1 bus")).toBeInTheDocument();
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ from: "Colombo", to: "Batticaloa", date: "2030-09-15", page_size: 10 }),
      expect.anything(),
    );
  });

  it("updates the URL when a filter changes", async () => {
    const user = userEvent.setup();
    search.mockResolvedValue(response());
    renderAt(QUERY);

    await user.click(await screen.findByRole("checkbox", { name: "Super Luxury" }));

    expect(navigation.replace).toHaveBeenCalledWith(`/search?${QUERY}&bus_type=super_luxury`, { scroll: false });
  });

  it("explains when no route links the places", async () => {
    search.mockResolvedValue(response({ count: 0, results: [], route_exists: false, facets: { ...response().facets, total: 0 } }));
    renderAt(QUERY);

    expect(await screen.findByText("No buses run from Colombo to Batticaloa")).toBeInTheDocument();
  });

  it("offers the nearest day with buses", async () => {
    const user = userEvent.setup();
    search.mockResolvedValue(
      response({ count: 0, results: [], nearest_available_date: "2030-09-16", facets: { ...response().facets, total: 0 } }),
    );
    renderAt(QUERY);

    expect(await screen.findByText("No buses on Sun, 15 Sep 2030")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "See buses on Mon, 16 Sep" }));

    expect(navigation.push).toHaveBeenCalledWith("/search?from=Colombo&to=Batticaloa&date=2030-09-16&passengers=1");
  });

  it("doesn't search past dates", () => {
    renderAt("from=Colombo&to=Batticaloa&date=2020-01-01&passengers=1");

    expect(screen.getByText("That date has passed")).toBeInTheDocument();
    expect(search).not.toHaveBeenCalled();
  });
});
