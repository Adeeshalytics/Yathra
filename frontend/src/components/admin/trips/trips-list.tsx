"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CalendarClockIcon, PlusIcon, RepeatIcon } from "lucide-react";
import Link from "next/link";

import { DateFilter, ListToolbar, SearchInput } from "@/components/admin/shared/list-toolbar";
import { PaginationBar } from "@/components/admin/shared/pagination-bar";
import { RowActions } from "@/components/admin/shared/record-controls";
import { DataTable, type DataTableColumn } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { FilterSelect } from "@/components/forms/select-field";
import { Button } from "@/components/ui/button";
import { useListState } from "@/hooks/use-list-state";
import { adminApi } from "@/lib/api/admin";
import type { AdminTrip } from "@/lib/api/admin-types";
import { queryKeys } from "@/lib/api/query-keys";
import { daysBetween, formatTime, formatTripDate, sriLankaParts } from "@/lib/datetime";
import { formatCurrency, pluralize } from "@/lib/format";
import { TRIP_STATUSES } from "@/lib/validations/trips";

import { tripMenuActions, useTripControls } from "./trip-controls";
import { SaleBadge, TripStatusBadge } from "./trip-status";
import { useBusOptions, useOperatorOptions, useRouteOptions } from "./use-trip-options";

const WHEN_OPTIONS = [
  { value: "true", label: "Upcoming" },
  { value: "false", label: "Past" },
];

/** Days between the departure date and the arrival date ("+1" for overnight journeys). */
export function arrivalDayShift(
  trip: Pick<AdminTrip, "departure_datetime" | "estimated_arrival_datetime">,
): number {
  return daysBetween(
    sriLankaParts(trip.departure_datetime).date,
    sriLankaParts(trip.estimated_arrival_datetime).date,
  );
}

export function TripsList() {
  const list = useListState({
    upcoming: "true",
    date: "",
    route: "all",
    bus: "all",
    operator: "all",
    status: "all",
  });
  // Past trips read best newest first.
  const params =
    list.filters.upcoming === "false" ? { ...list.params, ordering: "-departure_datetime" } : list.params;
  const query = useQuery({
    queryKey: queryKeys.admin.list("trips", params),
    queryFn: ({ signal }) => adminApi.trips.list(params, signal),
    placeholderData: keepPreviousData,
  });
  const routes = useRouteOptions();
  const buses = useBusOptions();
  const operators = useOperatorOptions();
  const controls = useTripControls();

  const columns: DataTableColumn<AdminTrip>[] = [
    {
      id: "code",
      header: "Trip ID",
      cell: (trip) => (
        <Link href={`/admin/trips/${trip.id}`} className="font-mono font-medium hover:underline">
          {trip.code}
        </Link>
      ),
    },
    {
      id: "route",
      header: "Route",
      cell: (trip) => (
        <div className="min-w-44">
          <Link href={`/admin/routes/${trip.route}`} className="font-medium hover:underline">
            {trip.route_summary.name}
          </Link>
          <p className="text-xs text-muted-foreground">
            {trip.route_summary.origin.name} → {trip.route_summary.destination.name}
          </p>
        </div>
      ),
    },
    {
      id: "bus",
      header: "Bus",
      cell: (trip) => (
        <div className="min-w-32">
          <Link href={`/admin/buses/${trip.bus}`} className="font-mono text-sm hover:underline">
            {trip.bus_summary.registration_number}
          </Link>
          <p className="max-w-40 truncate text-xs text-muted-foreground">{trip.bus_summary.name}</p>
        </div>
      ),
    },
    {
      id: "operator",
      header: "Operator",
      cell: (trip) => (
        <Link href={`/admin/operators/${trip.operator}`} className="hover:underline">
          {trip.operator_name}
        </Link>
      ),
    },
    {
      id: "date",
      header: "Date",
      cell: (trip) => <span className="whitespace-nowrap">{formatTripDate(trip.departure_datetime)}</span>,
    },
    {
      id: "departure",
      header: "Departure",
      cell: (trip) => {
        const shift = arrivalDayShift(trip);
        return (
          <div className="tabular-nums">
            <p className="font-medium">{formatTime(trip.departure_datetime)}</p>
            <p className="text-xs text-muted-foreground">
              arr. {formatTime(trip.estimated_arrival_datetime)}
              {shift > 0 && ` +${shift}d`}
            </p>
          </div>
        );
      },
    },
    {
      id: "price",
      header: "Price",
      cell: (trip) => <span className="tabular-nums">{formatCurrency(trip.base_price)}</span>,
    },
    {
      id: "seats",
      header: "Available seats",
      cell: (trip) => (
        <div className="tabular-nums">
          <p className="font-medium">
            {trip.available_seats}
            <span className="font-normal text-muted-foreground"> / {trip.bus_summary.seat_capacity}</span>
          </p>
          <p className="text-xs text-muted-foreground">{pluralize(trip.booking_count, "booking")}</p>
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (trip) => (
        <div className="flex flex-wrap gap-1.5">
          <TripStatusBadge status={trip.status} />
          <SaleBadge trip={trip} />
        </div>
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      className: "w-12 text-right",
      cell: (trip) => <RowActions label={trip.code} actions={tripMenuActions(trip, controls)} />,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trips"
        description="Every scheduled journey: route, bus, departure, price and seats left."
        actions={
          <>
            <Button asChild variant="outline" size="lg">
              <Link href="/admin/schedules">
                <RepeatIcon data-icon="inline-start" />
                Schedules
              </Link>
            </Button>
            <Button asChild size="lg">
              <Link href="/admin/trips/new">
                <PlusIcon data-icon="inline-start" />
                New trip
              </Link>
            </Button>
          </>
        }
      />
      <ListToolbar isFiltered={list.isFiltered} onReset={list.reset}>
        <SearchInput
          value={list.search}
          onChange={list.setSearch}
          placeholder="Search trip ID, route, plate…"
          label="Search trips"
        />
        <DateFilter
          label="Departure date"
          value={list.filters.date}
          onChange={(value) => {
            list.setFilter("date", value);
            // A specific day may be in the past: don't hide it behind "Upcoming".
            if (value) list.setFilter("upcoming", "all");
          }}
        />
        <FilterSelect
          label="When"
          value={list.filters.upcoming}
          onChange={(value) => list.setFilter("upcoming", value)}
          options={WHEN_OPTIONS}
          allLabel="Any time"
          className="sm:w-40"
        />
        <FilterSelect
          label="Route"
          value={list.filters.route}
          onChange={(value) => list.setFilter("route", value)}
          options={(routes.data?.results ?? []).map((route) => ({ value: route.id, label: route.name }))}
          className="sm:w-56"
        />
        <FilterSelect
          label="Bus"
          value={list.filters.bus}
          onChange={(value) => list.setFilter("bus", value)}
          options={(buses.data?.results ?? []).map((bus) => ({
            value: bus.id,
            label: `${bus.registration_number} · ${bus.name}`,
          }))}
        />
        <FilterSelect
          label="Operator"
          value={list.filters.operator}
          onChange={(value) => list.setFilter("operator", value)}
          options={(operators.data?.results ?? []).map((operator) => ({
            value: operator.id,
            label: operator.company_name,
          }))}
        />
        <FilterSelect
          label="Status"
          value={list.filters.status}
          onChange={(value) => list.setFilter("status", value)}
          options={TRIP_STATUSES}
        />
      </ListToolbar>
      <DataTable
        caption="Trips"
        columns={columns}
        data={query.data?.results}
        getRowId={(trip) => trip.id}
        isLoading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        emptyState={
          <EmptyState
            icon={CalendarClockIcon}
            title={list.isFiltered ? "No trips match your filters" : "No upcoming trips"}
            description={
              list.isFiltered
                ? "Try another date or clear the filters."
                : "Create a one-time trip, or generate trips from a recurring schedule."
            }
            action={
              list.isFiltered ? (
                <Button variant="outline" onClick={list.reset}>
                  Clear filters
                </Button>
              ) : (
                <Button asChild>
                  <Link href="/admin/trips/new">New trip</Link>
                </Button>
              )
            }
          />
        }
      />
      {query.data && (
        <PaginationBar
          page={list.page}
          totalPages={query.data.total_pages}
          count={query.data.count}
          onPageChange={list.setPage}
          isFetching={query.isFetching}
          noun="trip"
        />
      )}
      {controls.dialogs}
    </div>
  );
}
