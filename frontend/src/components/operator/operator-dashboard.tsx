"use client";

import { useQuery } from "@tanstack/react-query";
import {
  BusFrontIcon,
  CalendarClockIcon,
  ClipboardListIcon,
  TicketIcon,
  UsersIcon,
  WalletIcon,
} from "lucide-react";
import Link from "next/link";
import type { ComponentType, ReactNode } from "react";

import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { operatorApi } from "@/lib/api/endpoints";
import type { OperatorTripRow } from "@/lib/api/portal-types";
import { queryKeys } from "@/lib/api/query-keys";
import { formatClock, formatTripDate } from "@/lib/datetime";
import { formatCurrency, pluralize } from "@/lib/format";

import { SeatsSold } from "./trip-parts";

function Stat({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon: ComponentType<{ className?: string }>;
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 font-heading text-3xl font-bold tabular-nums">{value}</p>
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
          <Icon className="size-5" />
        </span>
      </CardContent>
    </Card>
  );
}

function NextDeparture({ trip }: { trip: OperatorTripRow }) {
  return (
    <li className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <Link href={`/operator/trips/${trip.id}`} className="font-medium hover:underline">
          {trip.origin} → {trip.destination}
        </Link>
        <p className="text-sm text-muted-foreground">
          {formatTripDate(trip.departure_datetime, { year: false })} · {formatClock(trip.departure_datetime)} · Bus{" "}
          <span className="font-mono">{trip.bus_registration}</span>
        </p>
      </div>
      <div className="flex items-center gap-4">
        <SeatsSold sold={trip.seats_sold} capacity={trip.capacity} />
        <Button asChild variant="outline" size="sm">
          <Link href={`/operator/trips/${trip.id}/manifest`}>
            <ClipboardListIcon data-icon="inline-start" />
            Manifest
          </Link>
        </Button>
      </div>
    </li>
  );
}

/** The company's day: what is running, who is travelling, what leaves next, and the takings. */
export function OperatorDashboard() {
  const query = useQuery({
    queryKey: queryKeys.operator.dashboard,
    queryFn: ({ signal }) => operatorApi.dashboard(signal),
    refetchInterval: 60_000,
  });

  if (query.isPending) {
    return (
      <div className="space-y-6" aria-busy>
        <Skeleton className="h-9 w-72" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-28 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    );
  }
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const { operator, today, upcoming, revenue } = query.data;
  return (
    <div className="space-y-8">
      <PageHeader
        title={operator.company_name}
        description="Today’s trips, the next departures and your takings."
        actions={
          <Button asChild variant="outline" size="lg">
            <Link href="/operator/trips">
              <CalendarClockIcon data-icon="inline-start" />
              All trips
            </Link>
          </Button>
        }
      />

      <section aria-labelledby="today-heading" className="space-y-3">
        <h2 id="today-heading" className="font-heading text-lg font-semibold">
          Today
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            label="Trips"
            value={today.trips}
            hint={today.cancelled_trips ? `${today.cancelled_trips} cancelled` : undefined}
            icon={BusFrontIcon}
          />
          <Stat
            label="Passengers"
            value={today.passengers}
            hint={`${today.boarded} boarded · ${today.occupancy}% of seats`}
            icon={UsersIcon}
          />
          <Stat
            label="Bookings paid today"
            value={today.bookings_sold}
            hint={pluralize(today.seats_sold, "seat")}
            icon={TicketIcon}
          />
          {revenue ? (
            <Stat
              label="Takings today"
              value={formatCurrency(revenue.today.net_revenue)}
              hint={`${formatCurrency(revenue.month.net_revenue)} this month`}
              icon={WalletIcon}
            />
          ) : (
            <Stat label="Next 7 days" value={upcoming.next_7_days} hint="scheduled trips" icon={CalendarClockIcon} />
          )}
        </div>
      </section>

      <Card>
        <CardHeader className="sm:flex sm:items-end sm:justify-between">
          <div className="space-y-1.5">
            <CardTitle>Next departures</CardTitle>
            <CardDescription>
              {pluralize(upcoming.next_7_days, "trip")} in the next 7 days. Print the manifest before the bus leaves.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {upcoming.trips.length === 0 ? (
            <EmptyState
              icon={CalendarClockIcon}
              title="No upcoming trips"
              description="Scheduled trips for your buses will appear here."
            />
          ) : (
            <ul className="divide-y">
              {upcoming.trips.map((trip) => (
                <NextDeparture key={trip.id} trip={trip} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {revenue && (
        <Card>
          <CardHeader className="sm:flex sm:items-end sm:justify-between">
            <div className="space-y-1.5">
              <CardTitle>This month</CardTitle>
              <CardDescription>Money taken for your trips, after refunds.</CardDescription>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/operator/revenue">Revenue report</Link>
            </Button>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-4">
              {[
                ["Gross", formatCurrency(revenue.month.gross_revenue)],
                ["Refunds", formatCurrency(revenue.month.refunds)],
                ["Net", formatCurrency(revenue.month.net_revenue)],
                ["Bookings", String(revenue.month.bookings)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-muted/60 p-4">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="font-heading text-xl font-bold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      )}

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <StatusBadge status={operator.status} /> Figures refresh every minute.
      </p>
    </div>
  );
}
