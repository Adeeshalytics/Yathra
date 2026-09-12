"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { BanIcon, DownloadIcon, Loader2Icon, PrinterIcon, TicketIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { BackLink } from "@/components/admin/shared/page-parts";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { StatusBadge } from "@/components/common/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { bookingsApi } from "@/lib/api/endpoints";
import { ApiError, getErrorMessage } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";
import { formatClock, formatTripDate } from "@/lib/datetime";
import { formatCurrency, formatDateTime, pluralize } from "@/lib/format";
import { saveBlob } from "@/lib/payment";
import { siteConfig } from "@/lib/site";

function Field({ label, children, note }: { label: string; children: ReactNode; note?: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="font-semibold break-words">{children}</dd>
      {note && <dd className="text-xs text-muted-foreground">{note}</dd>}
    </div>
  );
}

/** The customer's e-ticket: view it, download it as a PDF, or print it. */
export function TicketView({ id }: { id: string }) {
  const query = useQuery({
    queryKey: queryKeys.ticket(id),
    queryFn: ({ signal }) => bookingsApi.ticket(id, signal),
  });
  const download = useMutation({
    mutationFn: () => bookingsApi.ticketPdf(id),
    onSuccess: (blob) =>
      saveBlob(
        blob,
        `${siteConfig.name.toLowerCase()}-ticket-${query.data?.booking.booking_reference ?? id}.pdf`,
      ),
    onError: (error) =>
      toast.error(getErrorMessage(error, "We couldn’t download your ticket. Please try again.")),
  });

  if (query.isPending) {
    return (
      <div className="mx-auto max-w-3xl space-y-4" aria-busy>
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-[32rem] rounded-2xl" />
      </div>
    );
  }
  if (query.isError) {
    return query.error instanceof ApiError && query.error.status === 404 ? (
      <EmptyState
        icon={TicketIcon}
        title="Your e-ticket isn’t ready yet"
        description={
          query.error.code === "ticket_not_issued"
            ? query.error.message
            : "It may belong to another account, or the link is wrong."
        }
        action={
          <Button asChild variant="outline">
            <Link href={`/bookings/${id}`}>Your booking</Link>
          </Button>
        }
      />
    ) : (
      <ErrorState error={query.error} onRetry={() => void query.refetch()} />
    );
  }

  const ticket = query.data;
  const { booking } = ticket;
  const boardingTime = booking.boarding?.time ?? booking.trip.departure_datetime;
  const dropoffTime = booking.dropoff?.time;

  return (
    <div className="mx-auto max-w-3xl space-y-6 print:max-w-none print:space-y-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <BackLink href={`/bookings/${id}`}>Booking details</BackLink>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="lg" onClick={() => download.mutate()} disabled={download.isPending}>
            {download.isPending ? (
              <Loader2Icon className="animate-spin" data-icon="inline-start" />
            ) : (
              <DownloadIcon data-icon="inline-start" />
            )}
            Download PDF
          </Button>
          <Button variant="outline" size="lg" onClick={() => window.print()}>
            <PrinterIcon data-icon="inline-start" />
            Print
          </Button>
        </div>
      </div>

      {!ticket.is_valid && (
        <Alert variant="destructive" className="bg-destructive/5 print:hidden">
          <BanIcon />
          <AlertDescription>
            This ticket is {ticket.status_label.toLowerCase()} and can’t be used for travel.
          </AlertDescription>
        </Alert>
      )}

      <article
        aria-labelledby="ticket-heading"
        className="overflow-hidden rounded-2xl border bg-card shadow-sm print:rounded-none print:border-0 print:shadow-none"
      >
        <header className="flex flex-wrap items-center justify-between gap-4 bg-primary px-6 py-5 text-primary-foreground print:[print-color-adjust:exact]">
          <div>
            <p className="font-heading text-2xl font-bold">{siteConfig.name}</p>
            <p className="text-sm opacity-90">Bus e-ticket</p>
          </div>
          <div className="text-right">
            <p className="text-xs tracking-wide uppercase opacity-80">Booking reference</p>
            <p className="font-mono text-2xl font-bold">{booking.booking_reference}</p>
          </div>
        </header>

        <div className="grid gap-6 p-6 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0 space-y-5">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 id="ticket-heading" className="text-xl font-bold">
                  {booking.trip.route.name}
                </h1>
                <StatusBadge status={ticket.status} label={ticket.status_label} />
              </div>
              <p className="text-sm text-muted-foreground">
                {booking.trip.route.origin.city} → {booking.trip.route.destination.city} · Trip {booking.trip.code}
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
              <Field label="Travel date">{formatTripDate(boardingTime)}</Field>
              <Field label="Departure time" note="from your boarding point">
                {formatClock(boardingTime)}
              </Field>
              <Field label="Boarding point">{booking.boarding?.stop.name ?? booking.trip.route.origin.name}</Field>
              <Field label="Drop-off point" note={dropoffTime && `arrives about ${formatClock(dropoffTime)}`}>
                {booking.dropoff?.stop.name ?? booking.trip.route.destination.name}
              </Field>
              <Field label="Bus number" note={booking.trip.bus.bus_type_label}>
                <span className="font-mono">{booking.trip.bus.registration_number}</span>
              </Field>
              <Field label="Operator">{booking.trip.operator.name}</Field>
            </dl>
          </div>
          <figure className="flex flex-col items-center gap-2 self-start rounded-xl bg-muted/60 p-4 print:[print-color-adjust:exact]">
            <Image
              src={ticket.qr_code}
              alt={`QR code for ticket ${ticket.ticket_number}`}
              width={176}
              height={176}
              unoptimized
              className="size-44 rounded bg-white"
            />
            <figcaption className="text-center">
              <span className="block text-xs tracking-wide text-muted-foreground uppercase">Ticket number</span>
              <span className="font-mono font-semibold">{ticket.ticket_number}</span>
            </figcaption>
          </figure>
        </div>

        <section aria-labelledby="passengers-heading" className="border-t px-6 py-5">
          <h2 id="passengers-heading" className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Passengers
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th scope="col" className="w-20 pb-2 font-medium">
                  Seat
                </th>
                <th scope="col" className="pb-2 font-medium">
                  Passenger name
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {booking.passengers.map((passenger) => (
                <tr key={passenger.id}>
                  <td className="py-2 font-semibold tabular-nums">{passenger.seat_number}</td>
                  <td className="py-2">{passenger.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="flex flex-wrap items-end justify-between gap-4 border-t px-6 py-5">
          <div>
            <p className="text-xs tracking-wide text-muted-foreground uppercase">Amount paid</p>
            <p className="font-heading text-2xl font-bold tabular-nums">
              {formatCurrency(booking.total_amount, booking.currency)}
            </p>
            <p className="text-xs text-muted-foreground">
              {pluralize(booking.seats.length, "seat")}
              {ticket.payment && (
                <>
                  {" "}
                  · Payment <span className="font-mono">{ticket.payment.transaction_reference}</span>
                  {ticket.payment.payment_method_label && ` (${ticket.payment.payment_method_label})`}
                </>
              )}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">Issued {formatDateTime(ticket.issued_at)}</p>
        </section>

        <section className="border-t bg-muted/40 px-6 py-4 text-sm text-muted-foreground print:[print-color-adjust:exact]">
          <ul className="list-disc space-y-1 pl-5">
            <li>Show this QR code to the conductor when you board — on your phone or printed.</li>
            <li>Be at your boarding point 15 minutes before the departure time above.</li>
            <li>This ticket is valid only for the passengers, seats and journey shown.</li>
          </ul>
        </section>
      </article>
    </div>
  );
}
