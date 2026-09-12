"use client";

import { useEffect } from "react";

import "./globals.css";

/** Last-resort boundary for errors in the root layout itself. Renders its own document. */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-svh items-center justify-center bg-background p-6 font-sans text-foreground">
        <title>Something went wrong</title>
        <main className="max-w-md space-y-5 text-center">
          <h1 className="text-3xl font-bold">We hit a bump in the road</h1>
          <p className="text-muted-foreground">
            The app failed to load. Please try again in a moment.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            className="inline-flex h-11 items-center rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:bg-primary/90"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
