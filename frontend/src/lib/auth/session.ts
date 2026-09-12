/**
 * Client-side session state.
 *
 * - The short-lived JWT access token lives only in this module's memory (never in
 *   localStorage), so an XSS payload can't harvest it from storage.
 * - The refresh token is an HttpOnly cookie set by the API; JavaScript never sees it.
 * - On page load we exchange that cookie for a fresh access token ("bootstrap").
 *
 * React reads the state through `useSyncExternalStore` (see hooks/use-auth.ts).
 */
import type { AuthResponse, User } from "@/lib/api/types";
import { env } from "@/lib/env";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

export interface AuthState {
  status: AuthStatus;
  user: User | null;
  /** Why the user is signed out: an explicit logout vs. an expired/invalid session. */
  reason: "logout" | "expired" | null;
}

// Non-sensitive flag so first-time visitors don't trigger a pointless refresh request.
const SESSION_HINT_KEY = "yathra:has-session";
const LOADING: AuthState = { status: "loading", user: null, reason: null };

let accessToken: string | null = null;
let state: AuthState = LOADING;
let refreshInFlight: Promise<AuthResponse | null> | null = null;
let bootstrapped = false;
const listeners = new Set<() => void>();

function emit(next: AuthState) {
  state = next;
  listeners.forEach((listener) => listener());
}

function writeHint(present: boolean) {
  try {
    if (present) localStorage.setItem(SESSION_HINT_KEY, "1");
    else localStorage.removeItem(SESSION_HINT_KEY);
  } catch {
    // Storage can be unavailable (private mode, blocked cookies); the hint is only an optimisation.
  }
}

function readHint(): boolean {
  try {
    return localStorage.getItem(SESSION_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setSession(
  session: AuthResponse | null,
  reason: AuthState["reason"] = "logout",
): void {
  if (session) {
    accessToken = session.access;
    writeHint(true);
    emit({ status: "authenticated", user: session.user, reason: null });
  } else {
    accessToken = null;
    writeHint(false);
    emit({ status: "unauthenticated", user: null, reason });
  }
}

/** Update the signed-in user's own details after a profile edit; the token is untouched. */
export function updateSessionUser(user: User): void {
  if (state.status !== "authenticated") return;
  emit({ ...state, user });
}

/** Exchange the refresh cookie for a new access token. Concurrent callers share one request. */
export function refreshSession(): Promise<AuthResponse | null> {
  refreshInFlight ??= requestRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function requestRefresh(): Promise<AuthResponse | null> {
  try {
    const response = await fetch(`${env.NEXT_PUBLIC_API_URL}/auth/refresh/`, {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      setSession(null, "expired");
      return null;
    }
    const session = (await response.json()) as AuthResponse;
    setSession(session);
    return session;
  } catch {
    // Network failure: we can't tell whether the session is still valid, so keep the hint
    // and let the next page load try again.
    accessToken = null;
    emit({ status: "unauthenticated", user: null, reason: "expired" });
    return null;
  }
}

/** Restore the session once per page load, and keep tabs in sync. */
export function bootstrapSession(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  window.addEventListener("storage", (event) => {
    if (event.key !== SESSION_HINT_KEY) return;
    if (event.newValue === null && state.status === "authenticated") {
      accessToken = null;
      emit({ status: "unauthenticated", user: null, reason: "logout" });
    } else if (event.newValue === "1" && state.status !== "authenticated") {
      void refreshSession();
    }
  });

  if (readHint()) void refreshSession();
  else emit({ status: "unauthenticated", user: null, reason: null });
}

export const authStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: (): AuthState => state,
  getServerSnapshot: (): AuthState => LOADING,
};
