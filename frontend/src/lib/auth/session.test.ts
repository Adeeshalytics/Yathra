/**
 * Session persistence: the guarantees the whole signed-in experience rests on.
 *
 * The access token lives in memory only, the refresh token is an HttpOnly cookie the browser
 * sends for us, and a page reload restores the session from that cookie.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthResponse } from "@/lib/api/types";

const SESSION: AuthResponse = {
  access: "access-token-1",
  user: {
    id: "user-1",
    name: "Kasuni Fernando",
    email: "kasuni@example.com",
    phone: "+94771234567",
    role: "customer",
    is_active: true,
    created_at: "2030-09-01T09:00:00+05:30",
    updated_at: "2030-09-01T09:00:00+05:30",
  },
};

async function freshModule() {
  vi.resetModules();
  return import("./session");
}

describe("the session store", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the access token out of storage", async () => {
    const session = await freshModule();

    session.setSession(SESSION);

    expect(session.getAccessToken()).toBe("access-token-1");
    expect(JSON.stringify(localStorage)).not.toContain("access-token-1");
    expect(session.authStore.getSnapshot()).toMatchObject({
      status: "authenticated",
      user: SESSION.user,
    });
  });

  it("remembers only that a session exists, so a reload knows to ask", async () => {
    const session = await freshModule();

    session.setSession(SESSION);

    expect(localStorage.getItem("yathra:has-session")).toBe("1");
    session.setSession(null);
    expect(localStorage.getItem("yathra:has-session")).toBeNull();
  });

  it("restores the session from the refresh cookie on the next page load", async () => {
    localStorage.setItem("yathra:has-session", "1");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => SESSION });
    vi.stubGlobal("fetch", fetchMock);
    const session = await freshModule();

    session.bootstrapSession();
    await vi.waitFor(() =>
      expect(session.authStore.getSnapshot().status).toBe("authenticated"),
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/auth/refresh/");
    expect(init.credentials).toBe("include");
    expect(session.getAccessToken()).toBe("access-token-1");
  });

  it("does not call the API for a first-time visitor", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const session = await freshModule();

    session.bootstrapSession();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(session.authStore.getSnapshot().status).toBe("unauthenticated");
  });

  it("signs the user out when the refresh cookie has expired", async () => {
    localStorage.setItem("yathra:has-session", "1");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    const session = await freshModule();

    session.bootstrapSession();
    await vi.waitFor(() =>
      expect(session.authStore.getSnapshot()).toMatchObject({
        status: "unauthenticated",
        reason: "expired",
      }),
    );
  });

  it("shares one refresh request between concurrent callers", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => SESSION });
    vi.stubGlobal("fetch", fetchMock);
    const session = await freshModule();

    await Promise.all([
      session.refreshSession(),
      session.refreshSession(),
      session.refreshSession(),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("signing out in one tab signs out the others", async () => {
    const session = await freshModule();
    session.setSession(SESSION);
    session.bootstrapSession();

    window.dispatchEvent(
      new StorageEvent("storage", { key: "yathra:has-session", newValue: null }),
    );

    expect(session.authStore.getSnapshot().status).toBe("unauthenticated");
    expect(session.getAccessToken()).toBeNull();
  });

  it("updates the signed-in user without touching the token", async () => {
    const session = await freshModule();
    session.setSession(SESSION);

    session.updateSessionUser({ ...SESSION.user, name: "Kasuni Perera" });

    expect(session.authStore.getSnapshot().user?.name).toBe("Kasuni Perera");
    expect(session.getAccessToken()).toBe("access-token-1");
  });

  it("renders as loading on the server so the markup matches the first paint", async () => {
    const session = await freshModule();

    expect(session.authStore.getServerSnapshot()).toEqual({
      status: "loading",
      user: null,
      reason: null,
    });
  });
});
