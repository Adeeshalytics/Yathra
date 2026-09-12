"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { UsersIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import {
  BOARDING_LABELS,
  BOARDING_STATUS_OPTIONS,
} from "@/components/admin/bookings/booking-options";
import { DateFilter, ListToolbar, SearchInput } from "@/components/admin/shared/list-toolbar";
import { PaginationBar } from "@/components/admin/shared/pagination-bar";
import { useBusOptions, useRouteOptions } from "@/components/admin/trips/use-trip-options";
import { DataTable, type DataTableColumn } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { FilterSelect } from "@/components/forms/select-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useAdminMutation } from "@/hooks/use-admin-mutation";
import { useListState } from "@/hooks/use-list-state";
import { adminApi } from "@/lib/api/admin";
import { queryKeys } from "@/lib/api/query-keys";
import type { AdminPassengerRow } from "@/lib/api/report-types";
import { formatDateTime } from "@/lib/format";

function BoardingToggle({
  passenger,
  onToggle,
  pending,
}: {
  passenger: AdminPassengerRow;
  onToggle: (passenger: AdminPassengerRow, boarded: boolean) => void;
  pending: boolean;
}) {
  const boarded = passenger.boarding_status === "boarded";
  if (passenger.boarding_status === "released") {
    return <span className="text-xs text-muted-foreground">{BOARDING_LABELS.released}</span>;
  }
  return (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox
        checked={boarded}
        disabled={pending}
        onCheckedChange={(checked) => onToggle(passenger, checked === true)}
        aria-label={`Mark ${passenger.name} on seat ${passenger.seat_number} as boarded`}
      />
      <span className={boarded ? "font-medium" : "text-muted-foreground"}>
        {boarded ? BOARDING_LABELS.boarded : BOARDING_LABELS.expected}
      </span>
    </label>
  );
}

export function PassengersList() {
  const searchParams = useSearchParams();
  // Arriving from a trip or a booking pins the list to it; the rest are normal filters.
  const trip = searchParams.get("trip") ?? "";
  const booking = searchParams.get("booking") ?? "";
  const list = useListState({ route: "all", bus: "all", boarding_status: "all", date: "" });
  const params = { ...list.params, ...(trip && { trip }), ...(booking && { booking }) };

  const query = useQuery({
    queryKey: queryKeys.admin.list("passengers", params),
    queryFn: ({ signal }) => adminApi.passengers.list(params, signal),
    placeholderData: keepPreviousData,
  });
  const routes = useRouteOptions();
  const buses = useBusOptions();
  const boarding = useAdminMutation({
    mutationFn: ({ passenger, boarded }: { passenger: AdminPassengerRow; boarded: boolean }) =>
      adminApi.passengers.setBoarding(passenger.id, boarded),
    successMessage: (_, { passenger, boarded }) =>
      boarded
        ? `${passenger.name} is aboard (seat ${passenger.seat_number}).`
        : `${passenger.name} is no longer marked aboard.`,
  });

  const columns: DataTableColumn<AdminPassengerRow>[] = [
    {
      id: "passenger",
      header: "Passenger",
      cell: (passenger) => (
        <div className="min-w-40">
          <p className="max-w-48 truncate font-medium">{passenger.name}</p>
          <p className="text-xs text-muted-foreground">{passenger.phone || "—"}</p>
        </div>
      ),
    },
    {
      id: "booking",
      header: "Booking",
      cell: (passenger) => (
        <Link href={`/admin/bookings/${passenger.booking}`} className="block min-w-32 hover:underline">
          <span className="font-mono text-sm">{passenger.booking_reference}</span>
          <span className="block text-xs text-muted-foreground">{passenger.booking_status}</span>
        </Link>
      ),
    },
    {
      id: "seat",
      header: "Seat",
      cell: (passenger) => <span className="font-mono">{passenger.seat_number}</span>,
    },
    {
      id: "trip",
      header: "Trip",
      cell: (passenger) => (
        <Link href={`/admin/trips/${passenger.trip}`} className="block min-w-44 hover:underline">
          <span className="block max-w-52 truncate">{passenger.route_name}</span>
          <span className="text-xs text-muted-foreground">
            {passenger.departure ? formatDateTime(passenger.departure) : passenger.trip_code}
          </span>
        </Link>
      ),
    },
    {
      id: "points",
      header: "Boarding / drop-off",
      cell: (passenger) => (
        <div className="min-w-36 text-sm">
          <p className="max-w-44 truncate">{passenger.boarding_point || "—"}</p>
          <p className="max-w-44 truncate text-xs text-muted-foreground">
            {passenger.dropoff_point || "—"}
          </p>
        </div>
      ),
    },
    {
      id: "payment",
      header: "Payment",
      cell: (passenger) =>
        passenger.payment_status ? (
          <StatusBadge status={passenger.payment_status} />
        ) : (
          <span className="text-xs text-muted-foreground">Not started</span>
        ),
    },
    {
      id: "boarding",
      header: "Boarding",
      cell: (passenger) => (
        <BoardingToggle
          passenger={passenger}
          pending={boarding.isPending}
          onToggle={(row, boarded) => boarding.mutate({ passenger: row, boarded })}
        />
      ),
    },
  ];

  const pinned = trip || booking;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Passengers"
        description="Who is travelling, on which seat, and who has boarded. Filter by trip, route, bus, date or booking."
        actions={
          pinned ? (
            <Button asChild variant="outline">
              <Link href="/admin/passengers">Show all passengers</Link>
            </Button>
          ) : undefined
        }
      />
      <ListToolbar isFiltered={list.isFiltered} onReset={list.reset}>
        <SearchInput
          value={list.search}
          onChange={list.setSearch}
          placeholder="Search name, phone or booking…"
          label="Search passengers"
        />
        <FilterSelect
          label="Route"
          value={list.filters.route}
          onChange={(value) => list.setFilter("route", value)}
          options={(routes.data?.results ?? []).map((route) => ({
            value: route.id,
            label: route.name,
          }))}
          allLabel="All routes"
        />
        <FilterSelect
          label="Bus"
          value={list.filters.bus}
          onChange={(value) => list.setFilter("bus", value)}
          options={(buses.data?.results ?? []).map((bus) => ({
            value: bus.id,
            label: `${bus.registration_number} · ${bus.name}`,
          }))}
          allLabel="All buses"
        />
        <FilterSelect
          label="Boarding"
          value={list.filters.boarding_status}
          onChange={(value) => list.setFilter("boarding_status", value)}
          options={BOARDING_STATUS_OPTIONS}
        />
        <DateFilter
          label="Travelling on"
          value={list.filters.date}
          onChange={(value) => list.setFilter("date", value)}
        />
      </ListToolbar>
      <DataTable
        caption="Passengers"
        columns={columns}
        data={query.data?.results}
        getRowId={(passenger) => passenger.id}
        isLoading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        emptyState={
          <EmptyState
            icon={UsersIcon}
            title={
              list.isFiltered || pinned ? "No passengers match your filters" : "No passengers yet"
            }
            description={
              list.isFiltered || pinned
                ? "Try another route, bus or date, or clear the filters."
                : "Passengers appear here as soon as seats are booked."
            }
            action={
              list.isFiltered ? (
                <Button variant="outline" onClick={list.reset}>
                  Clear filters
                </Button>
              ) : undefined
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
          noun="passenger"
        />
      )}
    </div>
  );
}
