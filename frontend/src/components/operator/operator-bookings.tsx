"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { TicketIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { BOOKING_STATUS_OPTIONS } from "@/components/admin/bookings/booking-options";
import { DateFilter, ListToolbar, SearchInput } from "@/components/admin/shared/list-toolbar";
import { PaginationBar } from "@/components/admin/shared/pagination-bar";
import { DataTable, type DataTableColumn } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { FilterSelect } from "@/components/forms/select-field";
import { Button } from "@/components/ui/button";
import { useListState } from "@/hooks/use-list-state";
import { operatorApi } from "@/lib/api/endpoints";
import type { OperatorBookingRow } from "@/lib/api/portal-types";
import { queryKeys } from "@/lib/api/query-keys";
import { formatCurrency, formatDateTime } from "@/lib/format";

const COLUMNS: DataTableColumn<OperatorBookingRow>[] = [
  {
    id: "reference",
    header: "Booking",
    cell: (booking) => (
      <div className="min-w-32">
        <Link href={`/operator/bookings/${booking.id}`} className="font-mono text-sm font-medium hover:underline">
          {booking.booking_reference}
        </Link>
        <p className="text-xs text-muted-foreground">{formatDateTime(booking.created_at)}</p>
      </div>
    ),
  },
  {
    id: "customer",
    header: "Customer",
    cell: (booking) => (
      <div className="min-w-36">
        <p className="max-w-48 truncate">{booking.customer.name || "—"}</p>
        {booking.customer.phone && (
          <a href={`tel:${booking.customer.phone}`} className="text-xs text-muted-foreground hover:underline">
            {booking.customer.phone}
          </a>
        )}
      </div>
    ),
  },
  {
    id: "trip",
    header: "Trip",
    cell: (booking) => (
      <Link href={`/operator/trips/${booking.trip}`} className="block min-w-40 hover:underline">
        <p className="max-w-52 truncate">{booking.route_name}</p>
        <p className="text-xs text-muted-foreground">
          {booking.departure ? formatDateTime(booking.departure) : booking.trip_code}
        </p>
      </Link>
    ),
  },
  {
    id: "seats",
    header: "Seats",
    className: "text-right",
    cell: (booking) => <span className="tabular-nums">{booking.seats}</span>,
  },
  {
    id: "amount",
    header: "Amount",
    className: "text-right",
    cell: (booking) => (
      <span className="font-medium whitespace-nowrap tabular-nums">
        {formatCurrency(booking.total_amount, booking.currency)}
      </span>
    ),
  },
  {
    id: "status",
    header: "Status",
    cell: (booking) => <StatusBadge status={booking.status} label={booking.status_label} />,
  },
];

/** Every booking on the company's trips; searchable by reference, name or phone. */
export function OperatorBookings() {
  const trip = useSearchParams().get("trip") ?? "";
  const list = useListState({
    status: "all",
    departure_from: "",
    departure_to: "",
    trip,
  });
  const query = useQuery({
    queryKey: queryKeys.operator.bookings(list.params),
    queryFn: ({ signal }) => operatorApi.bookings.list(list.params, signal),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bookings"
        description="Everyone booked on your trips. Search by booking reference, passenger name or phone number."
      />
      <ListToolbar isFiltered={list.isFiltered} onReset={list.reset}>
        <SearchInput
          value={list.search}
          onChange={list.setSearch}
          placeholder="Reference, name or 077 123 4567…"
          label="Search bookings"
        />
        <FilterSelect
          label="Status"
          value={list.filters.status}
          onChange={(value) => list.setFilter("status", value)}
          options={BOOKING_STATUS_OPTIONS}
        />
        <DateFilter
          label="Travelling from"
          value={list.filters.departure_from}
          onChange={(value) => list.setFilter("departure_from", value)}
        />
        <DateFilter
          label="Travelling to"
          value={list.filters.departure_to}
          onChange={(value) => list.setFilter("departure_to", value)}
        />
        {list.filters.trip && (
          <Button variant="outline" size="lg" onClick={() => list.setFilter("trip", "")}>
            One trip only · show all
          </Button>
        )}
      </ListToolbar>
      <DataTable
        caption="Bookings"
        columns={COLUMNS}
        data={query.data?.results}
        getRowId={(booking) => booking.id}
        isLoading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        emptyState={
          <EmptyState
            icon={TicketIcon}
            title={list.isFiltered ? "No bookings match" : "No bookings yet"}
            description={
              list.isFiltered
                ? "Try another search, status or date."
                : "Bookings on your trips appear here as soon as customers reserve seats."
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
          noun="booking"
        />
      )}
    </div>
  );
}
