"use client";

import { ArrowLeftIcon, Loader2Icon, SearchXIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/errors";

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <ArrowLeftIcon className="size-4" aria-hidden />
      {children}
    </Link>
  );
}

export function DetailSkeleton() {
  return (
    <div className="space-y-6" aria-busy>
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-9 w-72" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    </div>
  );
}

/** Error view for a single record: a friendly 404, or a retryable error. */
export function RecordError({
  error,
  noun,
  backHref,
  onRetry,
}: {
  error: unknown;
  noun: string;
  backHref: string;
  onRetry?: () => void;
}) {
  if (error instanceof ApiError && error.status === 404) {
    return (
      <EmptyState
        icon={SearchXIcon}
        title={`This ${noun} doesn’t exist`}
        description="It may have been deleted, or the link is wrong."
        action={
          <Button asChild variant="outline">
            <Link href={backHref}>Back to the list</Link>
          </Button>
        }
      />
    );
  }
  return <ErrorState error={error} onRetry={onRetry} />;
}

export function FormErrorAlert({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null;
  return (
    <Alert variant="destructive" className="bg-destructive/5">
      <TriangleAlertIcon />
      <AlertDescription>
        {messages.length === 1 ? (
          messages[0]
        ) : (
          <ul className="list-disc space-y-1 pl-4">
            {messages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}
      </AlertDescription>
    </Alert>
  );
}

export function FormActions({
  submitLabel,
  pending,
  onCancel,
  disabled,
}: {
  submitLabel: string;
  pending: boolean;
  onCancel?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col-reverse gap-2 border-t pt-6 sm:flex-row sm:justify-end">
      {onCancel && (
        <Button type="button" variant="outline" size="xl" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      )}
      <Button type="submit" size="xl" disabled={pending || disabled}>
        {pending && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
        {submitLabel}
      </Button>
    </div>
  );
}
