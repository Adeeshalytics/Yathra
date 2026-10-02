import { getAccessToken, refreshSession } from "@/lib/auth/session";
import { env } from "@/lib/env";

import { ApiError } from "./errors";

type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions extends Omit<RequestInit, "body" | "credentials"> {
  /** Serialised as JSON. */
  body?: unknown;
  query?: Record<string, QueryValue>;
  /**
   * Attach the access token and, if it has expired, refresh it once and retry.
   * Public endpoints pass `false`. Default: true.
   */
  auth?: boolean;
}

export function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  // A path-only API base (/api/v1) resolves against the page's own origin.
  const origin = typeof window === "undefined" ? "http://localhost" : window.location.origin;
  const url = new URL(`${env.NEXT_PUBLIC_API_URL}/${path.replace(/^\/+/, "")}`, origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function doFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw ApiError.network();
  }
}

/** Sends the request (refreshing the session once on 401) and throws ApiError unless 2xx. */
async function send(path: string, options: RequestOptions, accept: string): Promise<Response> {
  const { body, query, auth = true, headers, ...rest } = options;
  const url = buildUrl(path, query);

  const buildInit = (token: string | null): RequestInit => {
    const requestHeaders = new Headers(headers);
    requestHeaders.set("Accept", accept);
    if (body !== undefined) requestHeaders.set("Content-Type", "application/json");
    if (token) requestHeaders.set("Authorization", `Bearer ${token}`);
    return {
      ...rest,
      headers: requestHeaders,
      // Needed so the browser sends/stores the HttpOnly refresh cookie on auth endpoints.
      credentials: "include",
      body: body === undefined ? undefined : JSON.stringify(body),
    };
  };

  const token = auth ? getAccessToken() : null;
  let response = await doFetch(url, buildInit(token));

  if (response.status === 401 && auth && token) {
    const session = await refreshSession();
    if (session) response = await doFetch(url, buildInit(session.access));
  }

  if (!response.ok) throw await ApiError.fromResponse(response);
  return response;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await send(path, options, "application/json");
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** A file download (e.g. a PDF) that needs the signed-in session. Errors still come as JSON. */
export async function apiBlob(path: string, options: RequestOptions = {}): Promise<Blob> {
  const response = await send(path, options, "application/pdf, application/json;q=0.9");
  return response.blob();
}

export interface DownloadedFile {
  blob: Blob;
  /** The name the server asked us to save it under, if it gave one. */
  filename: string;
}

function filenameFrom(header: string | null, fallback: string): string {
  const match = header?.match(/filename="?([^";]+)"?/i);
  return match ? match[1] : fallback;
}

/** A download whose type the server chooses (CSV, Excel or PDF), named by Content-Disposition. */
export async function apiDownload(
  path: string,
  fallbackName: string,
  options: RequestOptions = {},
): Promise<DownloadedFile> {
  const response = await send(path, options, "*/*");
  return {
    blob: await response.blob(),
    filename: filenameFrom(response.headers.get("Content-Disposition"), fallbackName),
  };
}

type MethodOptions = Omit<RequestOptions, "method" | "body">;

export const api = {
  get: <T>(path: string, options?: MethodOptions) =>
    apiRequest<T>(path, { ...options, method: "GET" }),
  post: <T>(path: string, body?: unknown, options?: MethodOptions) =>
    apiRequest<T>(path, { ...options, method: "POST", body }),
  patch: <T>(path: string, body?: unknown, options?: MethodOptions) =>
    apiRequest<T>(path, { ...options, method: "PATCH", body }),
  put: <T>(path: string, body?: unknown, options?: MethodOptions) =>
    apiRequest<T>(path, { ...options, method: "PUT", body }),
  delete: <T>(path: string, options?: MethodOptions) =>
    apiRequest<T>(path, { ...options, method: "DELETE" }),
  blob: (path: string, options?: MethodOptions) => apiBlob(path, { ...options, method: "GET" }),
  download: (path: string, fallbackName: string, options?: MethodOptions) =>
    apiDownload(path, fallbackName, { ...options, method: "GET" }),
};
