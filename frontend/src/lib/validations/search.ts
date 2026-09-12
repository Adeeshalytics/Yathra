import { z } from "zod";

import type { BusType } from "@/lib/api/admin-types";
import { todayInSriLanka } from "@/lib/format";

export const MAX_PASSENGERS = 10;
export const RESULTS_PER_PAGE = 10;

export const tripSearchSchema = z
  .object({
    from: z.string().min(1, { error: "Choose where you’re leaving from." }),
    to: z.string().min(1, { error: "Choose your destination." }),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Pick a travel date." })
      .refine((value) => value >= todayInSriLanka(), {
        error: "Travel date can’t be in the past.",
      }),
    passengers: z
      .string()
      .refine((value) => {
        const count = Number(value);
        return Number.isInteger(count) && count >= 1 && count <= MAX_PASSENGERS;
      }, { error: `Choose 1 to ${MAX_PASSENGERS} passengers.` }),
  })
  .refine((values) => !values.from || values.from !== values.to, {
    error: "Destination must be different from the departure point.",
    path: ["to"],
  });

export type TripSearchValues = z.infer<typeof tripSearchSchema>;

type Params = URLSearchParams | Record<string, string | string[] | undefined>;

function reader(params: Params) {
  return (key: string): string => {
    if (params instanceof URLSearchParams) return params.get(key) ?? "";
    const value = params[key];
    return typeof value === "string" ? value : "";
  };
}

/** Read search criteria from URL params, tolerating missing or malformed values. */
export function searchValuesFromParams(params: Params): TripSearchValues {
  const pick = reader(params);
  const passengers = Number(pick("passengers"));
  return {
    from: pick("from"),
    to: pick("to"),
    date: /^\d{4}-\d{2}-\d{2}$/.test(pick("date")) ? pick("date") : todayInSriLanka(),
    passengers:
      Number.isInteger(passengers) && passengers >= 1 && passengers <= MAX_PASSENGERS
        ? String(passengers)
        : "1",
  };
}

export function searchHref(values: TripSearchValues): string {
  return `/search?${new URLSearchParams(values).toString()}`;
}

// ---------------------------------------------------------------------------
// Results page state: criteria + sort + filters + page, all kept in the URL.
// ---------------------------------------------------------------------------
export const SORT_OPTIONS = [
  { value: "departure", label: "Earliest departure" },
  { value: "-departure", label: "Latest departure" },
  { value: "price", label: "Lowest price" },
  { value: "-price", label: "Highest price" },
  { value: "duration", label: "Shortest journey" },
  { value: "seats", label: "Most seats available" },
] as const;

export type SortValue = (typeof SORT_OPTIONS)[number]["value"];

export const DEPARTURE_PERIODS = [
  { value: "early_morning", label: "Before 6 AM", hours: "12 AM – 6 AM" },
  { value: "morning", label: "Morning", hours: "6 AM – 12 PM" },
  { value: "afternoon", label: "Afternoon", hours: "12 PM – 6 PM" },
  { value: "evening", label: "Evening & night", hours: "After 6 PM" },
] as const;

export type DeparturePeriod = (typeof DEPARTURE_PERIODS)[number]["value"];

const BUS_TYPE_VALUES: readonly BusType[] = ["normal", "ac", "luxury", "super_luxury"];
const PERIOD_VALUES = DEPARTURE_PERIODS.map((period) => period.value) as readonly string[];
const SORT_VALUES = SORT_OPTIONS.map((option) => option.value) as readonly string[];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRICE = /^\d{1,6}(\.\d{1,2})?$/;

export interface SearchFilters {
  busTypes: BusType[];
  /** "" = any, "true" = AC only, "false" = non-AC only */
  ac: "" | "true" | "false";
  minPrice: string;
  maxPrice: string;
  periods: DeparturePeriod[];
  operators: string[];
}

export interface SearchState extends TripSearchValues, SearchFilters {
  sort: SortValue;
  page: number;
}

export const NO_FILTERS: SearchFilters = {
  busTypes: [],
  ac: "",
  minPrice: "",
  maxPrice: "",
  periods: [],
  operators: [],
};

function list<T extends string>(raw: string, allowed: (value: string) => boolean): T[] {
  return [...new Set(raw.split(",").map((item) => item.trim()).filter(allowed))] as T[];
}

export function parseSearchState(params: Params): SearchState {
  const pick = reader(params);
  const page = Number(pick("page"));
  const ac = pick("ac");
  return {
    ...searchValuesFromParams(params),
    sort: (SORT_VALUES.includes(pick("sort")) ? pick("sort") : "departure") as SortValue,
    busTypes: list<BusType>(pick("bus_type"), (value) => (BUS_TYPE_VALUES as readonly string[]).includes(value)),
    ac: ac === "true" || ac === "false" ? ac : "",
    minPrice: PRICE.test(pick("min_price")) ? pick("min_price") : "",
    maxPrice: PRICE.test(pick("max_price")) ? pick("max_price") : "",
    periods: list<DeparturePeriod>(pick("departure"), (value) => PERIOD_VALUES.includes(value)),
    operators: list<string>(pick("operator"), (value) => UUID.test(value)),
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

/** Query parameters understood by both the results page URL and /api/v1/trips/search. */
function queryEntries(state: SearchState): [string, string][] {
  const entries: [string, string][] = [
    ["from", state.from],
    ["to", state.to],
    ["date", state.date],
    ["passengers", state.passengers],
  ];
  if (state.sort !== "departure") entries.push(["sort", state.sort]);
  if (state.busTypes.length) entries.push(["bus_type", state.busTypes.join(",")]);
  if (state.ac) entries.push(["ac", state.ac]);
  if (state.minPrice) entries.push(["min_price", state.minPrice]);
  if (state.maxPrice) entries.push(["max_price", state.maxPrice]);
  if (state.periods.length) entries.push(["departure", state.periods.join(",")]);
  if (state.operators.length) entries.push(["operator", state.operators.join(",")]);
  if (state.page > 1) entries.push(["page", String(state.page)]);
  return entries;
}

export function searchStateHref(state: SearchState): string {
  return `/search?${new URLSearchParams(queryEntries(state)).toString()}`;
}

export function toSearchApiParams(state: SearchState): Record<string, string | number> {
  return { ...Object.fromEntries(queryEntries(state)), page_size: RESULTS_PER_PAGE };
}

export function activeFilterCount(filters: SearchFilters): number {
  return (
    filters.busTypes.length +
    (filters.ac ? 1 : 0) +
    (filters.minPrice || filters.maxPrice ? 1 : 0) +
    filters.periods.length +
    filters.operators.length
  );
}

/** Whether the criteria can be sent to the API at all (the API re-validates). */
export function searchProblem(state: SearchState): "incomplete" | "past-date" | "same-place" | null {
  if (!state.from || !state.to) return "incomplete";
  if (state.from === state.to) return "same-place";
  if (state.date < todayInSriLanka()) return "past-date";
  return null;
}

/** Link to a trip page that carries the search context along. */
export function tripHref(
  tripId: string,
  context: { passengers: string | number; boarding?: string; dropoff?: string; search?: string },
): string {
  const params = new URLSearchParams({ passengers: String(context.passengers) });
  if (context.boarding) params.set("boarding", context.boarding);
  if (context.dropoff) params.set("dropoff", context.dropoff);
  if (context.search) params.set("back", context.search);
  return `/trips/${tripId}?${params.toString()}`;
}
