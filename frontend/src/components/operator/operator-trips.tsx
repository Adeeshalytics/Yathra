"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CalendarClockIcon, ClipboardListIcon } from "lucide-react";
import Link from "next/link";

import { DateFilter, ListToolbar, SearchInput } from "@/components/admin/shared/list-toolbar";
import { PaginationBar } from "@/components/admin/shared/pagination-bar";
import { DataTable, type DataTableColumn } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { FilterSelect } from "@/components/forms/select-field";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useListState } from "@/hooks/use-list-state";
import { operatorApi } from "@/lib/api/endpoints";
import type { OperatorTripRow } from "@/lib/api/portal-types";
import { queryKeys } from "@/lib/api/query-keys";
import { formatClock, formatTripDate } from "@/lib/datetime";

import { SeatsSold, TRIP_STATUS_OPTIONS } from "./trip-parts";

const COLUMNS: DataTableColumn<OperatorTripRow>[] = [
  {
    id: "departure",
    header: "Departure",
    cell: (trip) => (
      <div className="min-w-32">
        <p className="font-medium">{formatClock(trip.departure_datetime)}</p>
        <p className="text-xs text-muted-foreground">{formatTripDate(trip.departure_datetime)}</p>
      </div>
    ),
  },
  {
    id: "route",
    header: "Route",
    cell: (trip) => (
      <Link href={`/operator/trips/${trip.id}`} className="block min-w-44 hover:underline">
        <p className="max-w-56 truncate font-medium">
          {trip.origin} → {trip.destination}
        </p>
        <p className="font-mono text-xs text-muted-foreground">{trip.code}</p>
      </Link>
    ),
  },
  {
    id: "bus",
    header: "Bus",
    cell: (trip) => (
      <div className="min-w-28">
        <p className="font-mono text-sm">{trip.bus_registration}</p>
        <p className="max-w-40 truncate text-xs text-muted-foreground">{trip.bus_name}</p>
      </div>
    ),
  },
  {
    id: "seats",
    header: "Seats sold",
    cell: (trip) => <SeatsSold sold={trip.seats_sold} capacity={trip.capacity} />,
  },
  {
    id: "boarded",
    header: "Boarded",
    className: "text-right",
    cell: (trip) => <span className="tabular-nums">{trip.boarded}</span>,
  },
  {
    id: "status",
    header: "Status",
    cell: (trip) => <StatusBadge status={trip.status} label={trip.status_label} />,
  },
  {
    id: "manifest",
    header: <span className="sr-only">Manifest</span>,
    cell: (trip) => (
      <Button asChild variant="ghost" size="sm">
        <Link href={`/operator/trips/${trip.id}/manifest`} aria-label={`Manifest for trip ${trip.code}`}>
          <ClipboardListIcon data-icon="inline-start" />
          Manifest
        </Link>
      </Button>
    ),
  },
];

/** The company's trips: today and later by default, with seats sold and who has boarded. */
export function OperatorTrips() {
  const list = useListState({ when: "upcoming", status: "all", date_from: "", date_to: "" });
  const params = {
    ...list.params,
    ordering: list.filters.when === "past" ? "-departure_datetime" : "departure_datetime",
  };
  const filtered =
    list.search.trim() !== "" ||
    list.filters.status !== "all" ||
    list.filters.date_from !== "" ||
    list.filters.date_to !== "";
  const query = useQuery({
    queryKey: queryKeys.operator.trips(params),
    queryFn: ({ signal }) => operatorApi.trips.list(params, signal),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trips"
        description="Every departure on your buses. Open one for its stops and bookings, or print its manifest."
      />
      <Tabs value={list.filters.when} onValueChange={(value) => list.setFilter("when", value)}>
        <TabsList>
          <TabsTrigger value="upcoming">Today &amp; upcoming</TabsTrigger>
          <TabsTrigger value="past">Past</TabsTrigger>
        </TabsList>
      </Tabs>
      <ListToolbar
        isFiltered={filtered}
        onReset={() => {
          // Clearing filters keeps the tab you are on.
          const when = list.filters.when;
          list.reset();
          list.setFilter("when", when);
        }}
      >
        <SearchInput
          value={list.search}
          onChange={list.setSearch}
          placeholder="Search trip code, route or bus…"
          label="Search trips"
        />
        <FilterSelect
          label="Status"
          value={list.filters.status}
          onChange={(value) => list.setFilter("status", value)}
          options={TRIP_STATUS_OPTIONS}
        />
        <DateFilter
          label="From"
          value={list.filters.date_from}
          onChange={(value) => list.setFilter("date_from", value)}
        />
        <DateFilter
          label="To"
          value={list.filters.date_to}
          onChange={(value) => list.setFilter("date_to", value)}
        />
      </ListToolbar>
      <DataTable
        caption="Trips"
        columns={COLUMNS}
        data={query.data?.results}
        getRowId={(trip) => trip.id}
        isLoading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        emptyState={
          <EmptyState
            icon={CalendarClockIcon}
            title={list.filters.when === "past" ? "No past trips" : "No trips coming up"}
            description="Trips for your buses appear here once they are scheduled."
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
    </div>
  );
}
