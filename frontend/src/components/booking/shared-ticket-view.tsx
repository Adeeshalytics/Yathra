"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { BanIcon, DownloadIcon, Loader2Icon, PrinterIcon, TicketIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { StatusBadge } from "@/components/common/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ticketsApi } from "@/lib/api/endpoints";
import { ApiError, getErrorMessage } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";
import { formatClock, formatTripDate } from "@/lib/datetime";
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

/**
 * The ticket behind a link from an SMS or e-mail. No account needed — so it shows the journey
 * and the QR code, and nothing else about the booking.
 */
export function SharedTicketView({ code }: { code: string }) {
  const query = useQuery({
    queryKey: queryKeys.sharedTicket(code),
    queryFn: ({ signal }) => ticketsApi.shared(code, signal),
    retry: false,
  });
  const download = useMutation({
    mutationFn: () => ticketsApi.sharedPdf(code),
    onSuccess: (blob) =>
      saveBlob(
        blob,
        `${siteConfig.name.toLowerCase()}-ticket-${query.data?.booking_reference ?? "ticket"}.pdf`,
      ),
    onError: (error) =>
      toast.error(getErrorMessage(error, "We couldn’t download the ticket. Please try again.")),
  });

  if (query.isPending) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4" aria-busy>
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-[30rem] rounded-2xl" />
      </div>
    );
  }
  if (query.isError) {
    return query.error instanceof ApiError && query.error.status === 404 ? (
      <EmptyState
        icon={TicketIcon}
        title="This ticket link doesn’t work"
        description="Check that the whole link was copied from your text message. If it still doesn’t open, we can text your ticket again."
        action={
          <Button asChild>
            <Link href="/find-booking">Find my booking</Link>
          </Button>
        }
      />
    ) : (
      <ErrorState error={query.error} onRetry={() => void query.refetch()} />
    );
  }

  const ticket = query.data;
  const boardingTime = ticket.boarding?.time ?? ticket.trip.departure_datetime;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 print:max-w-none">
      <div className="flex flex-wrap justify-end gap-2 print:hidden">
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

      {!ticket.is_valid && (
        <Alert variant="destructive" className="bg-destructive/5 print:hidden">
          <BanIcon />
          <AlertDescription>
            This ticket is {ticket.status_label.toLowerCase()} and can’t be used for travel.
          </AlertDescription>
        </Alert>
      )}

      <article
        aria-labelledby="shared-ticket-heading"
        className="overflow-hidden rounded-2xl border bg-card shadow-sm print:rounded-none print:border-0 print:shadow-none"
      >
        <header className="flex flex-wrap items-center justify-between gap-4 bg-primary px-5 py-4 text-primary-foreground print:[print-color-adjust:exact]">
          <div>
            <p className="font-heading text-xl font-bold">{siteConfig.name}</p>
            <p className="text-sm opacity-90">Bus e-ticket</p>
          </div>
          <div className="text-right">
            <p className="text-xs tracking-wide uppercase opacity-80">Booking reference</p>
            <p className="font-mono text-xl font-bold">{ticket.booking_reference}</p>
          </div>
        </header>

        {/* On a phone at the bus door, the QR code comes first. */}
        <figure className="flex flex-col items-center gap-2 border-b bg-muted/50 px-5 py-6 print:[print-color-adjust:exact]">
          <Image
            src={ticket.qr_code}
            alt={`QR code for ticket ${ticket.ticket_number}`}
            width={208}
            height={208}
            unoptimized
            className="size-52 rounded bg-white p-1"
          />
          <figcaption className="text-center">
            <span className="block text-xs tracking-wide text-muted-foreground uppercase">Ticket number</span>
            <span className="font-mono font-semibold">{ticket.ticket_number}</span>
          </figcaption>
        </figure>

        <div className="space-y-5 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 id="shared-ticket-heading" className="text-lg font-bold">
              {ticket.boarding?.city ?? ticket.trip.route_name} → {ticket.dropoff?.city ?? ""}
            </h1>
            <StatusBadge status={ticket.status} label={ticket.status_label} />
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
            <Field label="Travel date">{formatTripDate(boardingTime)}</Field>
            <Field label="Board at" note="be there a little early">
              {formatClock(boardingTime)}
            </Field>
            <Field label="Boarding point">{ticket.boarding?.name ?? "—"}</Field>
            <Field
              label="Drop-off point"
              note={ticket.dropoff?.time ? `arrives about ${formatClock(ticket.dropoff.time)}` : undefined}
            >
              {ticket.dropoff?.name ?? "—"}
            </Field>
            <Field label="Bus number" note={ticket.trip.bus_type_label}>
              <span className="font-mono">{ticket.trip.bus_registration}</span>
            </Field>
            <Field label="Operator">{ticket.trip.operator_name}</Field>
          </dl>
        </div>

        <section aria-labelledby="shared-passengers-heading" className="border-t px-5 py-4">
          <h2
            id="shared-passengers-heading"
            className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
          >
            Passengers
          </h2>
          <ul className="divide-y text-sm">
            {ticket.passengers.map((passenger) => (
              <li key={passenger.seat_number} className="flex gap-4 py-2">
                <span className="w-16 font-semibold tabular-nums">Seat {passenger.seat_number}</span>
                <span>{passenger.name}</span>
              </li>
            ))}
          </ul>
        </section>
      </article>

      <p className="text-center text-xs text-muted-foreground print:hidden">
        Anyone with this link can open the ticket, so share it only with the people travelling.
      </p>
    </div>
  );
}
