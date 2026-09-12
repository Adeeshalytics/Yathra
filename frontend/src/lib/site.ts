import { env } from "@/lib/env";

export const siteConfig = {
  name: env.NEXT_PUBLIC_APP_NAME,
  tagline: "Intercity bus tickets across Sri Lanka",
  description:
    "Search routes, compare operators and reserve intercity bus seats anywhere in Sri Lanka.",
  timeZone: "Asia/Colombo",
  currency: "LKR",
} as const;
