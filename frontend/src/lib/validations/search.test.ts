import { describe, expect, it } from "vitest";

import {
  activeFilterCount,
  parseSearchState,
  searchProblem,
  searchStateHref,
  toSearchApiParams,
  tripHref,
} from "./search";

const OPERATOR = "3f6b1c2e-8a7d-4f0e-9c1b-2d3e4f5a6b7c";

describe("results page state", () => {
  it("reads criteria, sort and filters from the URL", () => {
    const state = parseSearchState(
      new URLSearchParams(
        `from=Colombo&to=Batticaloa&date=2030-09-15&passengers=2&sort=price&bus_type=luxury,super_luxury&ac=true&min_price=1000&departure=evening&operator=${OPERATOR}&page=3`,
      ),
    );

    expect(state).toMatchObject({
      from: "Colombo",
      to: "Batticaloa",
      date: "2030-09-15",
      passengers: "2",
      sort: "price",
      busTypes: ["luxury", "super_luxury"],
      ac: "true",
      minPrice: "1000",
      maxPrice: "",
      periods: ["evening"],
      operators: [OPERATOR],
      page: 3,
    });
    expect(activeFilterCount(state)).toBe(6);
  });

  it("ignores values it doesn't understand", () => {
    const state = parseSearchState(
      new URLSearchParams("from=A&to=B&date=soon&passengers=40&sort=cheap&bus_type=limo&ac=maybe&min_price=abc&operator=x&page=-2"),
    );

    expect(state).toMatchObject({
      passengers: "1",
      sort: "departure",
      busTypes: [],
      ac: "",
      minPrice: "",
      operators: [],
      page: 1,
    });
    expect(state.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("writes only what differs from the defaults", () => {
    const state = parseSearchState(new URLSearchParams("from=A&to=B&date=2030-09-15&passengers=1"));

    expect(searchStateHref(state)).toBe("/search?from=A&to=B&date=2030-09-15&passengers=1");
    expect(searchStateHref({ ...state, periods: ["morning", "evening"], page: 2 })).toBe(
      "/search?from=A&to=B&date=2030-09-15&passengers=1&departure=morning%2Cevening&page=2",
    );
    expect(toSearchApiParams({ ...state, ac: "false" })).toEqual({
      from: "A",
      to: "B",
      date: "2030-09-15",
      passengers: "1",
      ac: "false",
      page_size: 10,
    });
  });

  it("spots searches that can't be run", () => {
    const base = parseSearchState(new URLSearchParams("from=A&to=B&date=2030-09-15"));

    expect(searchProblem(base)).toBeNull();
    expect(searchProblem({ ...base, to: "" })).toBe("incomplete");
    expect(searchProblem({ ...base, to: "A" })).toBe("same-place");
    expect(searchProblem({ ...base, date: "2020-01-01" })).toBe("past-date");
  });

  it("links to a trip with the search context", () => {
    expect(tripHref("trip-1", { passengers: 2, boarding: "a", dropoff: "b", search: "from=A&to=B" })).toBe(
      "/trips/trip-1?passengers=2&boarding=a&dropoff=b&back=from%3DA%26to%3DB",
    );
  });
});
