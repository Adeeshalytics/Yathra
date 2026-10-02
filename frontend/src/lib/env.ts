import { z } from "zod";

/**
 * Either an absolute URL (the API on another host, as in local development) or a path on this
 * site such as `/api/v1` (the API behind the same host, as on Kubernetes). With a path, one
 * built image works on every domain it is deployed to. `//host` is refused: browsers read it
 * as another site.
 */
function isApiBase(value: string): boolean {
  if (value.startsWith("/")) return /^\/(?!\/)\S*$/.test(value);
  return URL.canParse(value) && /^https?:$/.test(new URL(value).protocol);
}

export const envSchema = z.object({
  NEXT_PUBLIC_API_URL: z
    .string()
    .refine(isApiBase, {
      error:
        "NEXT_PUBLIC_API_URL must be an absolute URL (http://localhost:8000/api/v1) or a path on this site (/api/v1)",
    })
    .transform((value) => value.replace(/\/+$/, "")),
  NEXT_PUBLIC_APP_NAME: z.string().min(1).default("Yathra"),
  /**
   * Map tiles. The default is OpenStreetMap, which is free but asks that heavy or commercial
   * use move to a provider or a self-hosted server — that is a change of these two values and
   * of the tile host allowed by the Content-Security-Policy in next.config.ts, nothing else.
   */
  NEXT_PUBLIC_MAP_TILE_URL: z
    .string()
    .min(1)
    .default("https://tile.openstreetmap.org/{z}/{x}/{y}.png"),
  NEXT_PUBLIC_MAP_TILE_ATTRIBUTION: z
    .string()
    .min(1)
    .default(
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    ),
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
  NEXT_PUBLIC_MAP_TILE_URL: process.env.NEXT_PUBLIC_MAP_TILE_URL || undefined,
  NEXT_PUBLIC_MAP_TILE_ATTRIBUTION: process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION || undefined,
});
