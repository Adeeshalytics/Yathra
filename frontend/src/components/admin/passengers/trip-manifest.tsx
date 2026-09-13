"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { DownloadIcon, Loader2Icon, PrinterIcon, UsersIcon } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { BackLink, DetailSkeleton, RecordError } from "@/components/admin/shared/page-parts";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { adminApi } from "@/lib/api/admin";
import { operatorApi } from "@/lib/api/endpoints";
import { getErrorMessage } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";
import type { ManifestRow, TripManifest } from "@/lib/api/report-types";
import { formatDateTime } from "@/lib/format";
import { saveBlob } from "@/lib/payment";

import { BOARDING_LABELS } from "../bookings/booking-options";

function cell(row: ManifestRow, key: string): string {
  const value = row[key];
  if (value === null || value === undefined || value === "") return "—";
  if (key === "boarding_state") return BOARDING_LABELS[String(value)] ?? String(value);
  return String(value);
}

function Heading({ manifest }: { manifest: TripManifest }) {
  const { trip, counts } = manifest;
  return (
    <header className="space-y-2 border-b pb-4">
      <h1 className="font-heading text-2xl font-bold">
        {trip.origin} → {trip.destination}
      </h1>
      <p className="text-lg">
        {trip.departure_date} · {trip.departure_time}
      </p>
      <p className="text-sm text-muted-foreground">
        Trip {trip.code} · Bus {trip.bus_registration} ({trip.bus_name}) · {trip.operator_name}
      </p>
      <p className="text-sm">
        {counts.passengers} of {counts.capacity} seats sold ({counts.occupancy}%) ·{" "}
        {counts.boarded} boarded · {counts.empty_seats} empty
      </p>
    </header>
  );
}

const SOURCES = {
  admin: {
    queryKey: queryKeys.admin.manifest,
    manifest: adminApi.trips.manifest,
    pdf: adminApi.trips.manifestPdf,
    tripHref: (id: string) => `/admin/trips/${id}`,
    listHref: "/admin/trips",
  },
  operator: {
    queryKey: queryKeys.operator.manifest,
    manifest: operatorApi.trips.manifest,
    pdf: operatorApi.trips.manifestPdf,
    tripHref: (id: string) => `/operator/trips/${id}`,
    listHref: "/operator/trips",
  },
};

/**
 * The crew's passenger list for one trip: readable on screen, and made to be printed. The
 * admin console and the operator portal show the same sheet, each from its own API.
 */
export function TripManifestView({
  tripId,
  scope = "admin",
}: {
  tripId: string;
  scope?: keyof typeof SOURCES;
}) {
  const source = SOURCES[scope];
  const query = useQuery({
    queryKey: source.queryKey(tripId),
    queryFn: ({ signal }) => source.manifest(tripId, signal),
  });
  const download = useMutation({
    mutationFn: (code: string) => source.pdf(tripId, code),
    onSuccess: ({ blob, filename }) => saveBlob(blob, filename),
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  if (query.isPending) return <DetailSkeleton />;
  if (query.isError) {
    return (
      <RecordError
        error={query.error}
        noun="trip"
        backHref={source.listHref}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const manifest = query.data;

  return (
    <div className="space-y-6 print:space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <BackLink href={source.tripHref(tripId)}>Trip</BackLink>
        <div className="flex flex-wrap gap-2">
          {scope === "admin" && (
            <Button asChild variant="outline" size="lg">
              <Link href={`/admin/passengers?trip=${tripId}`}>
                <UsersIcon data-icon="inline-start" />
                Boarding
              </Link>
            </Button>
          )}
          <Button
            variant="outline"
            size="lg"
            onClick={() => download.mutate(manifest.trip.code)}
            disabled={download.isPending}
          >
            {download.isPending ? (
              <Loader2Icon className="animate-spin" data-icon="inline-start" />
            ) : (
              <DownloadIcon data-icon="inline-start" />
            )}
            Download PDF
          </Button>
          <Button size="lg" onClick={() => window.print()}>
            <PrinterIcon data-icon="inline-start" />
            Print
          </Button>
        </div>
      </div>

      <article className="space-y-4 rounded-2xl border bg-card p-6 print:rounded-none print:border-0 print:p-0">
        <Heading manifest={manifest} />
        {manifest.passengers.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">
            Nobody has booked a seat on this trip yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {manifest.columns.map((column) => (
                    <TableHead key={column.key} className="px-3 text-muted-foreground">
                      {column.header}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {manifest.passengers.map((row) => (
                  <TableRow key={String(row.id)}>
                    {manifest.columns.map((column) => (
                      <TableCell
                        key={column.key}
                        className={
                          column.key === "seat_number" || column.key === "booking_reference"
                            ? "px-3 font-mono"
                            : "px-3"
                        }
                      >
                        {cell(row, column.key)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <footer className="flex flex-wrap justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
          <span>Printed {formatDateTime(manifest.printed_at)}</span>
          <span>Driver’s signature ______________________</span>
        </footer>
      </article>
    </div>
  );
}
