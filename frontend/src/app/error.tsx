"use client";

import { RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    // Hook for an error-reporting service (e.g. Sentry) later.
    console.error(error);
  }, [error]);

  return (
    <main
      id="main-content"
      className="container-page flex flex-1 flex-col items-center justify-center gap-6 py-20 text-center"
    >
      <span className="grid size-16 place-items-center rounded-full bg-destructive/10 text-destructive">
        <TriangleAlertIcon className="size-8" aria-hidden />
      </span>
      <div className="space-y-3">
        <h1 className="text-3xl font-bold">Something went wrong</h1>
        <p className="mx-auto max-w-md text-muted-foreground">
          An unexpected problem interrupted this page. Please try again.
          {error.digest && (
            <>
              {" "}
              If it keeps happening, contact support with reference{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-sm">{error.digest}</code>.
            </>
          )}
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <Button size="xl" onClick={() => retry()}>
          <RefreshCwIcon data-icon="inline-start" />
          Try again
        </Button>
        <Button asChild variant="outline" size="xl">
          <Link href="/">Go to home page</Link>
        </Button>
      </div>
    </main>
  );
}
