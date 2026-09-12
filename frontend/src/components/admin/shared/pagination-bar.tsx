"use client";

import { ChevronLeftIcon, ChevronRightIcon, Loader2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";

const DEFAULT_PAGE_SIZE = 20;

export function PaginationBar({
  page,
  totalPages,
  count,
  pageSize = DEFAULT_PAGE_SIZE,
  onPageChange,
  isFetching = false,
  noun = "result",
}: {
  page: number;
  totalPages: number;
  count: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
  isFetching?: boolean;
  noun?: string;
}) {
  if (count === 0) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, count);

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-col items-center justify-between gap-3 text-sm text-muted-foreground sm:flex-row"
    >
      <p aria-live="polite" className="flex items-center gap-2">
        {isFetching && <Loader2Icon className="size-4 animate-spin" aria-hidden />}
        Showing {first}–{last} of {count} {count === 1 ? noun : `${noun}s`}
      </p>
      {totalPages > 1 && (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="lg"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
          >
            <ChevronLeftIcon data-icon="inline-start" />
            Previous
          </Button>
          <span className="min-w-20 text-center tabular-nums">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="lg"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
          >
            Next
            <ChevronRightIcon data-icon="inline-end" />
          </Button>
        </div>
      )}
    </nav>
  );
}
