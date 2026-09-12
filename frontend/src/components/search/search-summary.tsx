"use client";

import { ArrowRightIcon, CalendarIcon, UsersIcon } from "lucide-react";

import { stopLabel, useStops } from "@/components/landing/trip-search-form";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCalendarDate } from "@/lib/format";
import type { TripSearchValues } from "@/lib/validations/search";

const UUID = /^[0-9a-f-]{36}$/i;

/** Heading for the results page: "Colombo → Batticaloa", date and passengers. */
export function SearchSummary({
  values,
  fromLabel,
  toLabel,
}: {
  values: TripSearchValues;
  /** Names resolved by the search API; used when available. */
  fromLabel?: string;
  toLabel?: string;
}) {
  const needsLookup = (!fromLabel && UUID.test(values.from)) || (!toLabel && UUID.test(values.to));
  const { data, isPending } = useStops();
  const stops = data?.results ?? [];
  const nameOf = (value: string, resolved?: string) => {
    if (resolved) return resolved;
    if (!UUID.test(value)) return value || "Anywhere";
    const stop = stops.find((candidate) => candidate.id === value);
    return stop ? stopLabel(stop) : "Selected stop";
  };
  const passengers = Number(values.passengers);

  return (
    <div className="space-y-2">
      <h1 id="results-heading" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xl font-bold sm:text-3xl">
        {needsLookup && isPending ? (
          <Skeleton className="h-9 w-72" />
        ) : (
          <>
            <span>{nameOf(values.from, fromLabel)}</span>
            <ArrowRightIcon className="size-6 text-primary" aria-label="to" />
            <span>{nameOf(values.to, toLabel)}</span>
          </>
        )}
      </h1>
      <p className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <CalendarIcon className="size-4" aria-hidden />
          {formatCalendarDate(values.date)}
        </span>
        <span className="flex items-center gap-1.5">
          <UsersIcon className="size-4" aria-hidden />
          {passengers} {passengers === 1 ? "passenger" : "passengers"}
        </span>
      </p>
    </div>
  );
}
