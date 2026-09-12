"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowRightIcon, TicketIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { PaginationBar } from "@/components/admin/shared/pagination-bar";
import { DataTable, type DataTableColumn } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { BookingScope, CustomerBooking } from "@/lib/api/booking-types";
import { bookingsApi } from "@/lib/api/endpoints";
import { queryKeys } from "@/lib/api/query-keys";
import { formatClock, formatTripDate } from "@/lib/datetime";
import { formatCurrency } from "@/lib/format";
import { canRetryPayment } from "@/lib/payment";

function departureOf(booking: CustomerBooking): string {
  return booking.boarding?.time ?? booking.trip.departure_datetime;
}

function routeOf(booking: CustomerBooking): string {
  const from = booking.boarding?.stop.name ?? booking.trip.route.origin.name;
  const to = booking.dropoff?.stop.name ?? booking.trip.route.destination.name;
  return `${from} → ${to}`;
}

/** What this booking most wants you to do next. */
function BookingAction({ booking }: { booking: CustomerBooking }): ReactNode {
  if (booking.ticket) {
    return (
      <Button asChild variant="outline" size="sm">
        <Link href={`/bookings/${booking.id}/ticket`}>
          <TicketIcon data-icon="inline-start" />
          E-ticket
        </Link>
      </Button>
    );
  }
  if (canRetryPayment(booking)) {
    return (
      <Button asChild variant="cta" size="sm">
        <Link href={`/bookings/${booking.id}/checkout`}>Pay now</Link>
      </Button>
    );
  }
  return (
    <Button asChild variant="ghost" size="sm">
      <Link href={`/bookings/${booking.id}`}>
        Details
        <ArrowRightIcon data-icon="inline-end" />
      </Link>
    </Button>
  );
}

const COLUMNS: DataTableColumn<CustomerBooking>[] = [
  {
    id: "reference",
    header: "Reference",
    cell: (booking) => (
      <Link
        href={`/bookings/${booking.id}`}
        className="font-mono text-sm font-semibold text-primary hover:underline"
      >
        {booking.booking_reference}
      </Link>
    ),
  },
  {
    id: "route",
    header: "Route",
    cell: (booking) => (
      <div className="min-w-48">
        <p className="font-medium">{routeOf(booking)}</p>
        <p className="text-xs text-muted-foreground">{booking.trip.operator.name}</p>
      </div>
    ),
  },
  {
    id: "date",
    header: "Date",
    cell: (booking) => (
      <span className="whitespace-nowrap">{formatTripDate(departureOf(booking))}</span>
    ),
  },
  {
    id: "departure",
    header: "Departure",
    cell: (booking) => (
      <span className="whitespace-nowrap tabular-nums">{formatClock(departureOf(booking))}</span>
    ),
  },
  {
    id: "seats",
    header: "Seats",
    cell: (booking) => <span className="tabular-nums">{booking.seats.join(", ") || "—"}</span>,
  },
  {
    id: "status",
    header: "Status",
    cell: (booking) => <StatusBadge status={booking.status} label={booking.status_label} />,
  },
  {
    id: "amount",
    header: "Amount",
    className: "text-right",
    cell: (booking) => (
      <span className="tabular-nums">
        {formatCurrency(booking.total_amount, booking.currency)}
      </span>
    ),
  },
  {
    id: "actions",
    header: <span className="sr-only">Actions</span>,
    className: "text-right",
    cell: (booking) => <BookingAction booking={booking} />,
  },
];

/** The same booking as a card, for phones where a seven-column table can't breathe. */
function BookingCard({ booking }: { booking: CustomerBooking }) {
  return (
    <li className="rounded-2xl border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Link
          href={`/bookings/${booking.id}`}
          className="font-mono text-sm font-semibold text-primary hover:underline"
        >
          {booking.booking_reference}
        </Link>
        <StatusBadge status={booking.status} label={booking.status_label} />
      </div>
      <p className="mt-2 font-medium">{routeOf(booking)}</p>
      <p className="text-sm text-muted-foreground">
        {formatTripDate(departureOf(booking))} · {formatClock(departureOf(booking))}
      </p>
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <div className="flex gap-1.5">
          <dt className="text-muted-foreground">
            {booking.seats.length === 1 ? "Seat" : "Seats"}
          </dt>
          <dd className="font-medium tabular-nums">{booking.seats.join(", ") || "—"}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-muted-foreground">Amount</dt>
          <dd className="font-medium tabular-nums">
            {formatCurrency(booking.total_amount, booking.currency)}
          </dd>
        </div>
      </dl>
      <div className="mt-3 flex justify-end">
        <BookingAction booking={booking} />
      </div>
    </li>
  );
}

const EMPTY: Record<BookingScope | "all", { title: string; description: string }> = {
  upcoming: {
    title: "No trips coming up",
    description: "When you book a seat, your journey shows up here.",
  },
  past: {
    title: "No previous trips yet",
    description: "Journeys you have travelled will be listed here.",
  },
  cancelled: {
    title: "Nothing cancelled",
    description: "Bookings you cancel — and their refunds — appear here.",
  },
  all: {
    title: "No bookings yet",
    description: "Search for a bus and your bookings will appear here.",
  },
};

/** One tab of the customer's booking history. */
export function BookingList({
  scope,
  page,
  onPageChange,
}: {
  scope: BookingScope | "all";
  page: number;
  onPageChange: (page: number) => void;
}) {
  const params = { page, ...(scope === "all" ? {} : { scope }) };
  const query = useQuery({
    queryKey: queryKeys.myBookings(params),
    queryFn: ({ signal }) => bookingsApi.mine(params, signal),
    placeholderData: keepPreviousData,
  });
  const bookings = query.data?.results;
  const empty = EMPTY[scope];
  const emptyState = (
    <EmptyState
      icon={TicketIcon}
      title={empty.title}
      description={empty.description}
      action={
        <Button asChild variant="cta">
          <Link href="/#search">Find a bus</Link>
        </Button>
      }
    />
  );

  return (
    <div className="space-y-4">
      {/* Phones get cards; from md up the full table with every column. */}
      <div className="md:hidden">
        {query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : query.isPending ? (
          <div className="space-y-3" aria-busy>
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-40 rounded-2xl" />
            ))}
          </div>
        ) : bookings && bookings.length === 0 ? (
          emptyState
        ) : (
          <ul className="space-y-3">
            {bookings?.map((booking) => (
              <BookingCard key={booking.id} booking={booking} />
            ))}
          </ul>
        )}
      </div>
      <div className="hidden md:block">
        <DataTable
          caption="Your bookings"
          columns={COLUMNS}
          data={bookings}
          getRowId={(booking) => booking.id}
          isLoading={query.isPending}
          error={query.error}
          onRetry={() => void query.refetch()}
          emptyState={emptyState}
        />
      </div>
      {query.data && (
        <PaginationBar
          page={page}
          totalPages={query.data.total_pages}
          count={query.data.count}
          onPageChange={onPageChange}
          isFetching={query.isFetching}
          noun="booking"
        />
      )}
    </div>
  );
}
