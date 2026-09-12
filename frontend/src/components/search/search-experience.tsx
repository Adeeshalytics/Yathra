"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  CalendarXIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FilterXIcon,
  MapPinOffIcon,
  PencilIcon,
  SearchIcon,
  SearchXIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { TripSearchForm } from "@/components/landing/trip-search-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { tripsApi } from "@/lib/api/endpoints";
import { ApiError, getErrorMessage } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";
import type { TripSearchResponse } from "@/lib/api/trip-types";
import { addDays, formatDay } from "@/lib/datetime";
import { pluralize, todayInSriLanka } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  NO_FILTERS,
  SORT_OPTIONS,
  activeFilterCount,
  parseSearchState,
  searchProblem,
  searchStateHref,
  toSearchApiParams,
  type SearchFilters as Filters,
  type SearchState,
  type SortValue,
} from "@/lib/validations/search";

import { BusCard, BusCardSkeleton } from "./bus-card";
import { SearchFilters } from "./search-filters";
import { SearchSummary } from "./search-summary";

function DateStrip({ date, onChange }: { date: string; onChange: (date: string) => void }) {
  const today = todayInSriLanka();
  const days = [-1, 0, 1, 2].map((offset) => addDays(date, offset));
  return (
    <nav aria-label="Change travel date" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      {days.map((day) => (
        <Button
          key={day}
          variant={day === date ? "default" : "outline"}
          size="lg"
          disabled={day < today}
          aria-current={day === date ? "date" : undefined}
          onClick={() => onChange(day)}
          className="shrink-0"
        >
          {formatDay(day, { year: false })}
        </Button>
      ))}
    </nav>
  );
}

function SortSelect({ value, onChange }: { value: SortValue; onChange: (value: SortValue) => void }) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as SortValue)}>
      <SelectTrigger aria-label="Sort buses" className="h-10 w-full bg-card sm:w-60">
        <span className="text-muted-foreground">Sort:</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="end">
        {SORT_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function NoResults({
  data,
  state,
  onDate,
  onClearFilters,
}: {
  data: TripSearchResponse;
  state: SearchState;
  onDate: (date: string) => void;
  onClearFilters: () => void;
}) {
  const { from, to } = data.search;
  if (!data.route_exists) {
    return (
      <EmptyState
        icon={MapPinOffIcon}
        title={`No buses run from ${from.label} to ${to.label}`}
        description="We couldn’t find a route between these places. Try a nearby town, or start from one of our popular routes."
        action={
          <Button asChild variant="outline">
            <Link href="/#popular-routes">Browse popular routes</Link>
          </Button>
        }
      />
    );
  }
  if (data.facets.total === 0) {
    const passengers = Number(state.passengers);
    return (
      <EmptyState
        icon={CalendarXIcon}
        title={`No buses on ${formatDay(state.date)}`}
        description={
          passengers > 1
            ? `We couldn’t find a bus with ${passengers} free seats that day.`
            : "Every bus on this journey is full or not running that day."
        }
        action={
          data.nearest_available_date ? (
            <Button onClick={() => onDate(data.nearest_available_date as string)}>
              See buses on {formatDay(data.nearest_available_date, { year: false })}
            </Button>
          ) : undefined
        }
      />
    );
  }
  return (
    <EmptyState
      icon={FilterXIcon}
      title="No buses match your filters"
      description={`${pluralize(data.facets.total, "bus", "buses")} run that day — try removing a filter.`}
      action={
        <Button variant="outline" onClick={onClearFilters}>
          Clear filters
        </Button>
      }
    />
  );
}

function SearchFailure({ error, onRetry, onEdit }: { error: unknown; onRetry: () => void; onEdit: () => void }) {
  if (error instanceof ApiError && error.status === 400) {
    const messages = Object.values(error.fieldErrors);
    return (
      <EmptyState
        icon={SearchXIcon}
        title="We couldn’t run this search"
        description={messages.length ? messages.join(" ") : getErrorMessage(error)}
        action={
          <Button variant="outline" onClick={onEdit}>
            <PencilIcon data-icon="inline-start" />
            Change search
          </Button>
        }
      />
    );
  }
  return <ErrorState title="Buses couldn’t be loaded" error={error} onRetry={onRetry} />;
}

export function SearchExperienceSkeleton() {
  return (
    <div className="container-page space-y-6 py-6 sm:py-10" aria-busy>
      <Skeleton className="h-9 w-80" />
      <Skeleton className="h-10 w-full max-w-md" />
      <div className="grid gap-6 lg:grid-cols-[17rem_1fr]">
        <Skeleton className="hidden h-96 rounded-2xl lg:block" />
        <div className="space-y-4">
          <BusCardSkeleton />
          <BusCardSkeleton />
        </div>
      </div>
    </div>
  );
}

/** The results page: criteria, sort, filters and page all live in the URL. */
export function SearchExperience() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const state = parseSearchState(searchParams);
  const problem = searchProblem(state);
  const apiParams = toSearchApiParams(state);
  const [editing, setEditing] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const query = useQuery({
    queryKey: queryKeys.tripSearch(apiParams),
    queryFn: ({ signal }) => tripsApi.search(apiParams, signal),
    enabled: problem === null,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const go = (next: SearchState, mode: "push" | "replace" = "replace") => {
    const href = searchStateHref(next);
    if (mode === "push") router.push(href);
    else router.replace(href, { scroll: false });
  };
  const setFilters = (patch: Partial<Filters>) => go({ ...state, ...patch, page: 1 });
  const setDate = (date: string) => go({ ...state, date, page: 1 }, "push");
  const clearFilters = () => setFilters(NO_FILTERS);

  const data = query.data;
  const filterCount = activeFilterCount(state);
  const backQuery = searchParams.toString();
  const searchValues = { from: state.from, to: state.to, date: state.date, passengers: state.passengers };

  const searchForm = (
    <Card>
      <CardHeader>
        <CardTitle>{problem === "incomplete" ? "Where are you going?" : "Change your search"}</CardTitle>
      </CardHeader>
      <CardContent>
        <TripSearchForm key={JSON.stringify(searchValues)} defaultValues={searchValues} submitLabel="Search buses" />
      </CardContent>
    </Card>
  );

  let body;
  if (problem === "incomplete") {
    body = searchForm;
  } else if (problem === "past-date" || problem === "same-place") {
    body = (
      <EmptyState
        icon={problem === "past-date" ? CalendarXIcon : MapPinOffIcon}
        title={problem === "past-date" ? "That date has passed" : "Pick two different places"}
        description={
          problem === "past-date"
            ? "Buses can only be searched for today or later."
            : "Your departure and destination are the same."
        }
        action={
          problem === "past-date" ? (
            <Button onClick={() => setDate(todayInSriLanka())}>Search today</Button>
          ) : (
            <Button variant="outline" onClick={() => setEditing(true)}>
              Change search
            </Button>
          )
        }
      />
    );
  } else {
    const filters = (idPrefix: string) => (
      <SearchFilters facets={data?.facets} filters={state} onChange={setFilters} idPrefix={idPrefix} />
    );
    body = (
      <div className="grid gap-6 lg:grid-cols-[17rem_1fr] lg:items-start">
        <aside aria-label="Filters" className="hidden rounded-2xl border bg-card p-5 lg:sticky lg:top-24 lg:block">
          {filters("desktop")}
        </aside>

        <section aria-labelledby="results-heading" className="min-w-0 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {query.isPending ? (
                "Searching buses…"
              ) : data ? (
                <>
                  <span className="font-semibold text-foreground">{pluralize(data.count, "bus", "buses")}</span>{" "}
                  found{filterCount > 0 && data.facets.total !== data.count && ` (of ${data.facets.total})`}
                </>
              ) : null}
            </p>
            <div className="flex gap-2">
              <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
                <SheetTrigger asChild>
                  <Button variant="outline" size="lg" className="h-10 flex-1 lg:hidden">
                    <SlidersHorizontalIcon data-icon="inline-start" />
                    Filters
                    {filterCount > 0 && <Badge className="ml-1">{filterCount}</Badge>}
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-sm">
                  <SheetHeader className="border-b">
                    <SheetTitle>Filter buses</SheetTitle>
                    <SheetDescription>
                      {data ? `${pluralize(data.count, "bus", "buses")} match` : "Narrow down the results"}
                    </SheetDescription>
                  </SheetHeader>
                  <div className="px-4 pb-6">{filters("mobile")}</div>
                  <div className="sticky bottom-0 mt-auto border-t bg-background p-4">
                    <Button className="w-full" size="xl" onClick={() => setFiltersOpen(false)}>
                      Show {data ? pluralize(data.count, "bus", "buses") : "buses"}
                    </Button>
                  </div>
                </SheetContent>
              </Sheet>
              <SortSelect value={state.sort} onChange={(sort) => go({ ...state, sort, page: 1 })} />
            </div>
          </div>

          {query.isError ? (
            <SearchFailure error={query.error} onRetry={() => void query.refetch()} onEdit={() => setEditing(true)} />
          ) : !data ? (
            <div className="space-y-4" aria-busy>
              <BusCardSkeleton />
              <BusCardSkeleton />
              <BusCardSkeleton />
            </div>
          ) : data.count === 0 ? (
            <NoResults data={data} state={state} onDate={setDate} onClearFilters={clearFilters} />
          ) : (
            <>
              <ol className={cn("space-y-4 transition-opacity", query.isPlaceholderData && "opacity-60")}>
                {data.results.map((trip) => (
                  <li key={trip.id}>
                    <BusCard trip={trip} passengers={Number(state.passengers)} backQuery={backQuery} />
                  </li>
                ))}
              </ol>
              {data.total_pages > 1 && (
                <nav aria-label="Result pages" className="flex items-center justify-between gap-3 pt-2">
                  <Button
                    variant="outline"
                    disabled={data.page <= 1}
                    onClick={() => go({ ...state, page: data.page - 1 }, "push")}
                  >
                    <ChevronLeftIcon data-icon="inline-start" />
                    Previous
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Page {data.page} of {data.total_pages}
                  </span>
                  <Button
                    variant="outline"
                    disabled={data.page >= data.total_pages}
                    onClick={() => go({ ...state, page: data.page + 1 }, "push")}
                  >
                    Next
                    <ChevronRightIcon data-icon="inline-end" />
                  </Button>
                </nav>
              )}
            </>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="container-page space-y-6 py-6 sm:py-10">
      {problem !== "incomplete" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <SearchSummary values={searchValues} fromLabel={data?.search.from.label} toLabel={data?.search.to.label} />
            <Button variant="outline" size="lg" onClick={() => setEditing((open) => !open)} aria-expanded={editing}>
              {editing ? <SearchIcon data-icon="inline-start" /> : <PencilIcon data-icon="inline-start" />}
              {editing ? "Hide search" : "Modify search"}
            </Button>
          </div>
          {editing && searchForm}
          {problem === null && <DateStrip date={state.date} onChange={setDate} />}
        </div>
      )}
      {body}
    </div>
  );
}
