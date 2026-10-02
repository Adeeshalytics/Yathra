import { describe, expect, it, vi } from "vitest";

// The deployed image is built with a path-only API base; the API sits behind the same host.
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_API_URL: "/api/v1" } }));

const { buildUrl } = await import("./client");

describe("buildUrl with a path-only API base", () => {
  it("resolves against the page's own origin", () => {
    expect(buildUrl("trips/search/")).toBe(`${window.location.origin}/api/v1/trips/search/`);
  });

  it("adds query parameters and skips empty ones", () => {
    const url = new URL(buildUrl("/trips/search/", { from: 3, to: "", date: null, page: 2 }));
    expect(url.pathname).toBe("/api/v1/trips/search/");
    expect(Object.fromEntries(url.searchParams)).toEqual({ from: "3", page: "2" });
  });
});
