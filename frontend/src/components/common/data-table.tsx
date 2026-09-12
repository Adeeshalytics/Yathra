"use client";

import type { ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { EmptyState } from "./empty-state";
import { ErrorState } from "./error-state";

export interface DataTableColumn<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[] | undefined;
  getRowId: (row: T) => string;
  /** Accessible description of the table (visually hidden). */
  caption: string;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  emptyState?: ReactNode;
  loadingRows?: number;
}

/** Table with built-in loading skeleton, error and empty states. */
export function DataTable<T>({
  columns,
  data,
  getRowId,
  caption,
  isLoading = false,
  error,
  onRetry,
  emptyState,
  loadingRows = 4,
}: DataTableProps<T>) {
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (!isLoading && data && data.length === 0) {
    return emptyState ?? <EmptyState title="Nothing here yet" />;
  }

  return (
    <div className="overflow-hidden rounded-2xl border bg-card">
      <Table>
        <TableCaption className="sr-only">{caption}</TableCaption>
        <TableHeader className="bg-muted/60">
          <TableRow className="hover:bg-transparent">
            {columns.map((column) => (
              <TableHead key={column.id} className={cn("px-4 text-muted-foreground", column.className)}>
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody aria-busy={isLoading || undefined}>
          {isLoading || !data
            ? Array.from({ length: loadingRows }, (_, index) => (
                <TableRow key={index}>
                  {columns.map((column) => (
                    <TableCell key={column.id} className="px-4 py-3">
                      <Skeleton className="h-4 w-full max-w-36" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : data.map((row) => (
                <TableRow key={getRowId(row)}>
                  {columns.map((column) => (
                    <TableCell key={column.id} className={cn("px-4 py-3", column.className)}>
                      {column.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
        </TableBody>
      </Table>
    </div>
  );
}
