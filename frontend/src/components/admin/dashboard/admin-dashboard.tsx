"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Building2Icon,
  BusFrontIcon,
  CalendarClockIcon,
  CircleCheckIcon,
  Grid3x3Icon,
  MapPinIcon,
  PlusIcon,
  RouteIcon,
} from "lucide-react";
import Link from "next/link";
import type { ComponentType, ReactNode } from "react";

import { ErrorState } from "@/components/common/error-state";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { adminApi } from "@/lib/api/admin";
import type { DashboardSummary } from "@/lib/api/admin-types";
import { queryKeys } from "@/lib/api/query-keys";
import { formatDateTime, pluralize } from "@/lib/format";

import { ActivityFeed } from "./activity-feed";
import { TradingCharts } from "./charts";

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  href,
}: {
  label: string;
  value: number | undefined;
  hint?: ReactNode;
  icon: ComponentType<{ className?: string }>;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Card className="h-full transition-shadow group-hover:shadow-md group-hover:ring-primary/25">
        <CardContent className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{label}</p>
            {value === undefined ? (
              <Skeleton className="mt-2 h-8 w-12" />
            ) : (
              <p className="mt-1 font-heading text-3xl font-bold tabular-nums">{value}</p>
            )}
            {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
          </div>
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
            <Icon className="size-5" />
          </span>
        </CardContent>
      </Card>
    </Link>
  );
}

function UpcomingTrips({ trips }: { trips: DashboardSummary["upcoming_trips"] | undefined }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Upcoming trips</CardTitle>
        <CardDescription>Scheduled departures across every route.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-muted/60 p-4">
            <p className="text-xs text-muted-foreground">Scheduled</p>
            {trips ? (
              <p className="font-heading text-2xl font-bold tabular-nums">{trips.total}</p>
            ) : (
              <Skeleton className="mt-1 h-7 w-10" />
            )}
          </div>
          <div className="rounded-xl bg-muted/60 p-4">
            <p className="text-xs text-muted-foreground">Next 7 days</p>
            {trips ? (
              <p className="font-heading text-2xl font-bold tabular-nums">{trips.next_7_days}</p>
            ) : (
              <Skeleton className="mt-1 h-7 w-10" />
            )}
          </div>
        </div>
        {trips && trips.next.length > 0 && (
          <ul className="divide-y text-sm">
            {trips.next.map((trip) => (
              <li key={trip.id}>
                <Link
                  href={`/admin/trips/${trip.id}`}
                  className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 hover:bg-muted/60"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{trip.route_name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      <span className="font-mono">{trip.code}</span> · {trip.bus_registration} ·{" "}
                      {trip.operator_name}
                    </p>
                  </div>
                  <time dateTime={trip.departure_datetime} className="shrink-0 text-right text-muted-foreground">
                    {formatDateTime(trip.departure_datetime)}
                  </time>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {trips && trips.next.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No departures are scheduled yet.{" "}
            <Link href="/admin/schedules" className="text-primary hover:underline">
              Set up a schedule
            </Link>{" "}
            to generate trips.
          </p>
        )}
        <Button asChild variant="outline" size="lg" className="w-full">
          <Link href="/admin/trips">View all trips</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export function AdminDashboard() {
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: queryKeys.admin.dashboard,
    queryFn: ({ signal }) => adminApi.dashboard(signal),
  });

  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard"
        description="Fleet, network and operator health at a glance."
        actions={
          <>
            <Button asChild variant="outline" size="lg">
              <Link href="/admin/routes/new">
                <PlusIcon data-icon="inline-start" />
                Route
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/admin/buses/new">
                <PlusIcon data-icon="inline-start" />
                Bus
              </Link>
            </Button>
            <Button asChild size="lg">
              <Link href="/admin/trips/new">
                <PlusIcon data-icon="inline-start" />
                Trip
              </Link>
            </Button>
          </>
        }
      />

      {isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <>
          <section
            aria-label="Key figures"
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5"
          >
            <StatCard label="Total buses" value={data?.buses.total} icon={BusFrontIcon} href="/admin/buses" />
            <StatCard
              label="Active buses"
              value={data?.buses.active}
              hint={data && `${data.buses.total - data.buses.active} inactive`}
              icon={CircleCheckIcon}
              href="/admin/buses"
            />
            <StatCard label="Total routes" value={data?.routes.total} icon={RouteIcon} href="/admin/routes" />
            <StatCard
              label="Active routes"
              value={data?.routes.active}
              hint={data && `${data.routes.total - data.routes.active} inactive`}
              icon={CircleCheckIcon}
              href="/admin/routes"
            />
            <StatCard
              label="Total operators"
              value={data?.operators.total}
              hint={data && `${data.operators.active} active · ${data.operators.pending} pending`}
              icon={Building2Icon}
              href="/admin/operators"
            />
          </section>

          <TradingCharts />

          <div className="grid gap-6 lg:grid-cols-[1fr_1.15fr] lg:items-start">
            <div className="space-y-6">
              <UpcomingTrips trips={data?.upcoming_trips} />
              <Card>
                <CardHeader>
                  <CardTitle>Network</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-3 text-sm">
                  <Link href="/admin/stops" className="flex items-center gap-3 rounded-xl border p-3 hover:bg-muted/60">
                    <MapPinIcon className="size-5 text-primary" aria-hidden />
                    <span>
                      {data ? pluralize(data.stops.active, "active stop") : <Skeleton className="h-4 w-20" />}
                    </span>
                  </Link>
                  <Link href="/admin/seat-layouts" className="flex items-center gap-3 rounded-xl border p-3 hover:bg-muted/60">
                    <Grid3x3Icon className="size-5 text-primary" aria-hidden />
                    <span>
                      {data ? pluralize(data.seat_layouts.total, "seat layout") : <Skeleton className="h-4 w-20" />}
                    </span>
                  </Link>
                </CardContent>
              </Card>
            </div>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CalendarClockIcon className="size-4 text-muted-foreground" aria-hidden />
                  Recent activity
                </CardTitle>
                <CardDescription>The latest changes made by administrators.</CardDescription>
              </CardHeader>
              <CardContent>
                <ActivityFeed entries={data?.recent_activity} isLoading={isPending} />
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
