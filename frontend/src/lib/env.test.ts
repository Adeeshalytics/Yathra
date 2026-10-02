import { describe, expect, it } from "vitest";

import { envSchema } from "./env";

const apiUrl = envSchema.shape.NEXT_PUBLIC_API_URL;

describe("NEXT_PUBLIC_API_URL", () => {
  it("accepts an absolute http(s) URL and drops trailing slashes", () => {
    expect(apiUrl.parse("https://api.example.com/api/v1/")).toBe("https://api.example.com/api/v1");
    expect(apiUrl.parse("http://localhost:8000/api/v1")).toBe("http://localhost:8000/api/v1");
  });

  it("accepts a path on the same site", () => {
    expect(apiUrl.parse("/api/v1")).toBe("/api/v1");
    expect(apiUrl.parse("/api/v1/")).toBe("/api/v1");
  });

  it.each([
    ["a protocol-relative URL, which points at another site", "//evil.example/api/v1"],
    ["a relative path without a leading slash", "api/v1"],
    ["a non-http scheme", "javascript:alert(1)"],
    ["a path with spaces", "/api v1"],
    ["an empty value", ""],
  ])("rejects %s", (_, value) => {
    expect(apiUrl.safeParse(value).success).toBe(false);
  });
});
