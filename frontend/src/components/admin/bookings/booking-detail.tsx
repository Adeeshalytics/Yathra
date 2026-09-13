"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { BanIcon, DownloadIcon, Loader2Icon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { DetailList } from "@/components/admin/shared/detail-list";
import { BackLink, DetailSkeleton, RecordError } from "@/components/admin/shared/page-parts";
import { DataTable, type DataTableColumn } from "@/components/common/data-table";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { adminApi } from "@/lib/api/admin";
import type { BookingPassenger, CustomerBooking } from "@/lib/api/booking-types";
import { bookingsApi } from "@/lib/api/endpoints";
import { getErrorMessage } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { saveBlob } from "@/lib/payment";

import { AdminCancelBookingDialog } from "./cancel-booking-dialog";

const PASSENGER_COLUMNS: DataTableColumn<BookingPassenger>[] = [
  { id: "seat", header: "Seat", cell: (passenger) => <span className="font-mono">{passenger.seat_number}</span> },
  { id: "name", header: "Passenger", cell: (passenger) => passenger.name },
  { id: "phone", header: "Phone", cell: (passenger) => passenger.phone || "—" },
  { id: "email", header: "Email", cell: (passenger) => passenger.email || "—" },
];

function TicketButton({ booking }: { booking: CustomerBooking }) {
  const download = useMutation({
    mutationFn: () => bookingsApi.ticketPdf(booking.id),
    onSuccess: (blob) => saveBlob(blob, `yathra-ticket-${booking.booking_reference}.pdf`),
    onError: (error) => toast.error(getErrorMessage(error)),
  });
  if (!booking.ticket) return null;
  return (
    <Button variant="outline" size="lg" onClick={() => download.mutate()} disabled={download.isPending}>
      {download.isPending ? (
        <Loader2Icon className="animate-spin" data-icon="inline-start" />
      ) : (
        <DownloadIcon data-icon="inline-start" />
      )}
      E-ticket
    </Button>
  );
}

export function AdminBookingDetail({ id }: { id: string }) {
  const [cancelling, setCancelling] = useState(false);
  const query = useQuery({
    queryKey: queryKeys.admin.detail("bookings", id),
    queryFn: ({ signal }) => adminApi.bookings.get(id, signal),
  });

  if (query.isPending) return <DetailSkeleton />;
  if (query.isError) {
    return (
      <RecordError
        error={query.error}
        noun="booking"
        backHref="/admin/bookings"
        onRetry={() => void query.refetch()}
      />
    );
  }

  const booking = query.data;
  const money = (amount: string) => formatCurrency(amount, booking.currency);
  const payment = booking.payment;

  return (
    <div className="space-y-6">
      <BackLink href="/admin/bookings">Bookings</BackLink>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h1 className="font-mono text-2xl font-bold break-all">{booking.booking_reference}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <StatusBadge status={booking.status} label={booking.status_label} />
            <span>
              {booking.customer.name} · {booking.seats.length} seat
              {booking.seats.length === 1 ? "" : "s"} · {money(booking.total_amount)}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <TicketButton booking={booking} />
          {booking.cancellation.allowed && (
            <Button variant="destructive" size="lg" onClick={() => setCancelling(true)}>
              <BanIcon data-icon="inline-start" />
              Cancel booking
            </Button>
          )}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Journey</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList
              items={[
                {
                  label: "Route",
                  value: (
                    <Link href={`/admin/trips/${booking.trip.id}`} className="hover:underline">
                      {booking.trip.route.name}
                    </Link>
                  ),
                  wide: true,
                },
                { label: "Trip", value: <span className="font-mono">{booking.trip.code}</span> },
                { label: "Operator", value: booking.trip.operator.name },
                { label: "Departure", value: formatDateTime(booking.trip.departure_datetime) },
                { label: "Arrival (est.)", value: formatDateTime(booking.trip.arrival_datetime) },
                {
                  label: "Boarding point",
                  value: booking.boarding
                    ? `${booking.boarding.stop.name}${booking.boarding.time ? ` · ${formatDateTime(booking.boarding.time)}` : ""}`
                    : "—",
                },
                {
                  label: "Drop-off point",
                  value: booking.dropoff
                    ? `${booking.dropoff.stop.name}${booking.dropoff.time ? ` · ${formatDateTime(booking.dropoff.time)}` : ""}`
                    : "—",
                },
                {
                  label: "Bus",
                  value: `${booking.trip.bus.name} · ${booking.trip.bus.registration_number}`,
                },
                { label: "Seats", value: booking.seats.join(", ") || "—" },
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Customer &amp; payment</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList
              items={[
                { label: "Customer", value: booking.customer.name },
                { label: "Email", value: booking.customer.email || "—" },
                { label: "Phone", value: booking.customer.phone || "—" },
                { label: "Booked", value: formatDateTime(booking.created_at) },
                {
                  label: "Confirmed",
                  value: booking.confirmed_at ? formatDateTime(booking.confirmed_at) : "—",
                },
                { label: "Total", value: money(booking.total_amount) },
                {
                  label: "Payment",
                  value: payment ? (
                    <Link href={`/admin/payments/${payment.id}`} className="hover:underline">
                      <StatusBadge status={payment.status} label={payment.status_label} />
                    </Link>
                  ) : (
                    "Not started"
                  ),
                },
                {
                  label: "E-ticket",
                  value: booking.ticket ? (
                    <span className="font-mono">{booking.ticket.ticket_number}</span>
                  ) : (
                    "Issued on payment"
                  ),
                },
                {
                  label: "Cancelled",
                  value: booking.cancelled_at ? formatDateTime(booking.cancelled_at) : "—",
                },
                {
                  label: "Cancellation reason",
                  value: booking.cancellation_reason || "—",
                  wide: true,
                },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      {booking.refunds.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Refunds</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {booking.refunds.map((refund) => (
              <div
                key={refund.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm"
              >
                <span className="font-mono">{refund.reference}</span>
                <StatusBadge status={refund.status} label={refund.status_label} />
                <span className="tabular-nums">{formatCurrency(refund.amount, refund.currency)}</span>
                <span className="text-muted-foreground">{formatDateTime(refund.created_at)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <section className="space-y-3">
        <h2 className="text-xl font-bold">Passengers</h2>
        <DataTable
          caption={`Passengers on ${booking.booking_reference}`}
          columns={PASSENGER_COLUMNS}
          data={booking.passengers}
          getRowId={(passenger) => passenger.id}
        />
      </section>

      {cancelling && (
        <AdminCancelBookingDialog booking={booking} onClose={() => setCancelling(false)} />
      )}
    </div>
  );
}
