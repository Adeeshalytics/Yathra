"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { TicketIcon } from "lucide-react";
import Link from "next/link";

import { DateFilter, ListToolbar, SearchInput } from "@/components/admin/shared/list-toolbar";
import { PaginationBar } from "@/components/admin/shared/pagination-bar";
import { DataTable, type DataTableColumn } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { FilterSelect } from "@/components/forms/select-field";
import { Button } from "@/components/ui/button";
import { useListState } from "@/hooks/use-list-state";
import { adminApi } from "@/lib/api/admin";
import { queryKeys } from "@/lib/api/query-keys";
import type { AdminBookingRow } from "@/lib/api/report-types";
import { formatCurrency, formatDateTime } from "@/lib/format";

import { BOOKING_PAYMENT_OPTIONS, BOOKING_STATUS_OPTIONS } from "./booking-options";

const COLUMNS: DataTableColumn<AdminBookingRow>[] = [
  {
    id: "reference",
    header: "Booking",
    cell: (booking) => (
      <div className="min-w-36">
        <Link
          href={`/admin/bookings/${booking.id}`}
          className="font-mono text-sm font-medium hover:underline"
        >
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
      <div className="min-w-40">
        <p className="max-w-48 truncate">{booking.customer.name}</p>
        <p className="max-w-48 truncate text-xs text-muted-foreground">{booking.customer.email || booking.customer.phone}</p>
      </div>
    ),
  },
  {
    id: "trip",
    header: "Route & trip",
    cell: (booking) => (
      <Link href={`/admin/trips/${booking.trip}`} className="block min-w-44 hover:underline">
        <p className="max-w-52 truncate">{booking.route_name}</p>
        <p className="font-mono text-xs text-muted-foreground">{booking.trip_code}</p>
      </Link>
    ),
  },
  {
    id: "departure",
    header: "Departure",
    cell: (booking) => (
      <span className="whitespace-nowrap">
        {booking.departure ? formatDateTime(booking.departure) : "—"}
      </span>
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
      <div className="tabular-nums">
        <p className="font-medium">{formatCurrency(booking.total_amount, booking.currency)}</p>
        {booking.paid_amount !== booking.total_amount && (
          <p className="text-xs text-muted-foreground">
            {formatCurrency(booking.paid_amount, booking.currency)} paid
          </p>
        )}
      </div>
    ),
  },
  {
    id: "payment",
    header: "Payment",
    cell: (booking) =>
      booking.payment_status ? (
        <StatusBadge status={booking.payment_status} />
      ) : (
        <span className="text-xs text-muted-foreground">Not started</span>
      ),
  },
  {
    id: "status",
    header: "Booking",
    cell: (booking) => <StatusBadge status={booking.status} label={booking.status_label} />,
  },
];

export function BookingsList() {
  const list = useListState({
    status: "all",
    payment_status: "all",
    date_from: "",
    date_to: "",
    departure_from: "",
    departure_to: "",
  });
  const query = useQuery({
    queryKey: queryKeys.admin.list("bookings", list.params),
    queryFn: ({ signal }) => adminApi.bookings.list(list.params, signal),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bookings"
        description="Every booking on the platform. Open one to see the passengers, the payment and the e-ticket, or to cancel it for a customer."
      />
      <ListToolbar isFiltered={list.isFiltered} onReset={list.reset}>
        <SearchInput
          value={list.search}
          onChange={list.setSearch}
          placeholder="Search reference, customer, passenger…"
          label="Search bookings"
        />
        <FilterSelect
          label="Status"
          value={list.filters.status}
          onChange={(value) => list.setFilter("status", value)}
          options={BOOKING_STATUS_OPTIONS}
        />
        <FilterSelect
          label="Payment"
          value={list.filters.payment_status}
          onChange={(value) => list.setFilter("payment_status", value)}
          options={BOOKING_PAYMENT_OPTIONS}
        />
        <DateFilter
          label="Booked from"
          value={list.filters.date_from}
          onChange={(value) => list.setFilter("date_from", value)}
        />
        <DateFilter
          label="Booked to"
          value={list.filters.date_to}
          onChange={(value) => list.setFilter("date_to", value)}
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
            title={list.isFiltered ? "No bookings match your filters" : "No bookings yet"}
            description={
              list.isFiltered
                ? "Try another status or date, or clear the filters."
                : "Bookings appear here as soon as customers reserve their seats."
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
          noun="booking"
        />
      )}
    </div>
  );
}
