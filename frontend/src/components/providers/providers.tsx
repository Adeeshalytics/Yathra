"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";

import { Toaster } from "@/components/ui/sonner";
import { ApiError } from "@/lib/api/errors";
import { bootstrapSession } from "@/lib/auth/session";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        refetchOnWindowFocus: false,
        // Client errors (401/403/404/422...) won't fix themselves; only retry network/5xx.
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
          return failureCount < 2;
        },
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

function getQueryClient() {
  // Fresh client per server render; one long-lived client in the browser.
  if (typeof window === "undefined") return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    bootstrapSession();
  }, []);

  return (
    <QueryClientProvider client={getQueryClient()}>
      {children}
      <Toaster theme="light" position="top-center" richColors closeButton />
    </QueryClientProvider>
  );
}
