import { z } from "zod";

const envSchema = z.object({
  NEXT_PUBLIC_API_URL: z
    .url({ error: "NEXT_PUBLIC_API_URL must be an absolute URL, e.g. http://localhost:8000/api/v1" })
    .transform((value) => value.replace(/\/+$/, "")),
  NEXT_PUBLIC_APP_NAME: z.string().min(1).default("Yathra"),
});

/**
 * Validated public configuration. NEXT_PUBLIC_* variables must be referenced literally so
 * Next.js can inline them into the browser bundle. A missing API URL fails the production
 * build instead of silently pointing at localhost.
 */
export const env = envSchema.parse({
  NEXT_PUBLIC_API_URL:
    process.env.NEXT_PUBLIC_API_URL ??
    (process.env.NODE_ENV === "development" ? "http://localhost:8000/api/v1" : undefined),
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME || undefined,
});
