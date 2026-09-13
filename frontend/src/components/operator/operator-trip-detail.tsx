"use client";

import { useQuery } from "@tanstack/react-query";
import { ClipboardListIcon, TicketIcon } from "lucide-react";
import Link from "next/link";

import { DetailList } from "@/components/admin/shared/detail-list";
import { BackLink, DetailSkeleton, RecordError } from "@/components/admin/shared/page-parts";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { operatorApi } from "@/lib/api/endpoints";
import { queryKeys } from "@/lib/api/query-keys";
import { formatClock, formatTripDate } from "@/lib/datetime";
import { formatCurrency } from "@/lib/format";

import { SeatsSold } from "./trip-parts";

export function OperatorTripDetail({ id }: { id: string }) {
  const query = useQuery({
    queryKey: queryKeys.operator.trip(id),
    queryFn: ({ signal }) => operatorApi.trips.get(id, signal),
  });

  if (query.isPending) return <DetailSkeleton />;
  if (query.isError) {
    return (
      <RecordError
        error={query.error}
        noun="trip"
        backHref="/operator/trips"
        onRetry={() => void query.refetch()}
      />
    );
  }

  const trip = query.data;
  return (
    <div className="space-y-6">
      <BackLink href="/operator/trips">Trips</BackLink>
      <PageHeader
        title={`${trip.origin} → ${trip.destination}`}
        description={`${formatTripDate(trip.departure_datetime)} · ${formatClock(trip.departure_datetime)} · Trip ${trip.code}`}
        actions={
          <>
            <Button asChild variant="outline" size="lg">
              <Link href={`/operator/bookings?trip=${trip.id}`}>
                <TicketIcon data-icon="inline-start" />
                Bookings
              </Link>
            </Button>
            <Button asChild size="lg">
              <Link href={`/operator/trips/${trip.id}/manifest`}>
                <ClipboardListIcon data-icon="inline-start" />
                Manifest
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <Card>
          <CardHeader>
            <CardTitle>Trip</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <DetailList
              items={[
                { label: "Status", value: <StatusBadge status={trip.status} label={trip.status_label} /> },
                { label: "Route", value: trip.route_name },
                {
                  label: "Bus",
                  value: (
                    <>
                      <span className="font-mono">{trip.bus_registration}</span> · {trip.bus_name}
                    </>
                  ),
                },
                { label: "Fare", value: formatCurrency(trip.base_price) },
                { label: "Seats sold", value: <SeatsSold sold={trip.seats_sold} capacity={trip.capacity} /> },
                { label: "Boarded", value: `${trip.boarded} of ${trip.seats_sold}` },
                {
                  label: "Bookings",
                  value: `${trip.bookings.confirmed} paid · ${trip.bookings.awaiting_payment} awaiting payment · ${trip.bookings.cancelled} cancelled`,
                  wide: true,
                },
                ...(trip.cancellation_reason
                  ? [{ label: "Why it was cancelled", value: trip.cancellation_reason, wide: true }]
                  : []),
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Stops</CardTitle>
            <CardDescription>Where passengers get on and off, and when.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3">
              {trip.stops.map((stop) => (
                <li key={stop.sequence} className="flex items-baseline justify-between gap-4 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium">{stop.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {[stop.is_boarding_point && "Boarding", stop.is_dropoff_point && "Drop-off"]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {stop.departure_datetime ? formatClock(stop.departure_datetime) : "—"}
                  </span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        {trip.revenue && (
          <Card>
            <CardHeader>
              <CardTitle>Takings</CardTitle>
              <CardDescription>Everything paid for this trip, less refunds.</CardDescription>
            </CardHeader>
            <CardContent>
              <DetailList
                items={[
                  { label: "Gross", value: formatCurrency(trip.revenue.gross_revenue) },
                  { label: "Refunds", value: formatCurrency(trip.revenue.refunds) },
                  { label: "Net", value: formatCurrency(trip.revenue.net_revenue) },
                  { label: "Paid bookings", value: String(trip.revenue.bookings) },
                ]}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
