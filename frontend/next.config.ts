import type { NextConfig } from "next";

/**
 * The API the browser talks to. Its origin has to be named in connect-src, because the
 * Content-Security-Policy below only allows this app to call itself otherwise.
 */
function apiOrigin(): string {
  const url = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

/**
 * A deliberately modest policy: it shuts down the things an injected script would reach for
 * (plugins, a rewritten <base>, framing, calls to other origins) without pretending we can drop
 * inline scripts — Next.js inlines its own bootstrap, and a nonce would need middleware on every
 * request. Payment gateways are navigated to, and post their forms back, so `form-action` stays
 * open to HTTPS.
 */
function contentSecurityPolicy(): string {
  const origin = apiOrigin();
  const connect = ["'self'", origin].filter(Boolean).join(" ");
  // Only ask the browser to upgrade http:// requests once the deployment is actually on HTTPS;
  // on a local machine it would break the plain-HTTP API.
  const https = origin.startsWith("https://");
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self' https:",
    // QR codes arrive as data: URIs; blob: is used when a downloaded PDF is opened.
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
    `connect-src ${connect}`,
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy() },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
];

const nextConfig: NextConfig = {
  // Self-contained server bundle for the production Docker image.
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
