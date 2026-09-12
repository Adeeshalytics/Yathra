"use client";

import { useQuery } from "@tanstack/react-query";
import {
  BanIcon,
  ClipboardListIcon,
  EyeOffIcon,
  PencilIcon,
  RepeatIcon,
  RotateCcwIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { BUS_TYPE_LABEL } from "@/components/admin/buses/buses-list";
import { FacilityList } from "@/components/admin/buses/facilities";
import { DetailList } from "@/components/admin/shared/detail-list";
import { BackLink, DetailSkeleton, RecordError } from "@/components/admin/shared/page-parts";
import { RowActions } from "@/components/admin/shared/record-controls";
import { PageHeader } from "@/components/common/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAdminMutation } from "@/hooks/use-admin-mutation";
import { adminApi } from "@/lib/api/admin";
import type { TripStatus } from "@/lib/api/admin-types";
import { queryKeys } from "@/lib/api/query-keys";
import { formatTime, formatTripDate, minutesBetween } from "@/lib/datetime";
import { formatCurrency, formatDate, formatDateTime, formatDuration, pluralize } from "@/lib/format";

import { tripMenuActions, tripRef, useTripControls } from "./trip-controls";
import { STATUS_ACTION_LABEL, SaleBadge, TripStatusBadge, isOpenTrip } from "./trip-status";
import { TripTimeline } from "./trip-timeline";

/** The usual next step, offered as the primary button. */
const FORWARD: Partial<Record<TripStatus, TripStatus>> = {
  scheduled: "boarding",
  boarding: "departed",
  departed: "completed",
};

const linkClass = "text-primary hover:underline";

export function TripDetail({ id }: { id: string }) {
  const router = useRouter();
  const query = useQuery({
    queryKey: queryKeys.admin.detail("trips", id),
    queryFn: ({ signal }) => adminApi.trips.get(id, signal),
  });
  const controls = useTripControls();
  const resetTimings = useAdminMutation({
    mutationFn: () => adminApi.trips.resetTimings(id),
    successMessage: (trip) => `Stop times for ${trip.code} now follow the route timetable.`,
  });

  if (query.isPending) return <DetailSkeleton />;
  if (query.isError) {
    return (
      <RecordError error={query.error} noun="trip" backHref="/admin/trips" onRetry={() => void query.refetch()} />
    );
  }

  const trip = query.data;
  const route = trip.route_summary;
  const bus = trip.bus_summary;
  const forward = FORWARD[trip.status];
  const menu = tripMenuActions(trip, controls, {
    onDetailPage: true,
    onDeleted: () => router.push("/admin/trips"),
  }).filter((action) => !forward || action.label !== STATUS_ACTION_LABEL[forward]);

  const stats: { label: string; value: ReactNode; hint: string }[] = [
    {
      label: "Departure",
      value: formatTime(trip.departure_datetime),
      hint: formatTripDate(trip.departure_datetime, { year: false }),
    },
    {
      label: "Arrival",
      value: formatTime(trip.estimated_arrival_datetime),
      hint: formatTripDate(trip.estimated_arrival_datetime, { year: false }),
    },
    {
      label: "Journey",
      value: formatDuration(minutesBetween(trip.departure_datetime, trip.estimated_arrival_datetime)),
      hint: pluralize(trip.stops.length, "stop"),
    },
    { label: "Ticket price", value: formatCurrency(trip.base_price), hint: "per seat" },
    { label: "Seat capacity", value: bus.seat_capacity, hint: bus.seat_layout_name ?? "No layout" },
    {
      label: "Bookings",
      value: trip.booking_count,
      hint: `${pluralize(trip.booked_seats, "seat")} booked`,
    },
    { label: "Available seats", value: trip.available_seats, hint: `of ${bus.seat_capacity}` },
  ];

  return (
    <div className="space-y-6">
      <BackLink href="/admin/trips">Trips</BackLink>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{trip.code}</span>
            <TripStatusBadge status={trip.status} />
            <SaleBadge trip={trip} />
          </span>
        }
        description={`${route.name} · ${formatTripDate(trip.departure_datetime)} at ${formatTime(trip.departure_datetime)}`}
        actions={
          <>
            <Button asChild variant="outline" size="lg">
              <Link href={`/admin/trips/${id}/manifest`}>
                <ClipboardListIcon data-icon="inline-start" />
                Manifest
              </Link>
            </Button>
            {trip.status === "scheduled" && (
              <Button asChild variant="outline" size="lg">
                <Link href={`/admin/trips/${id}/edit`}>
                  <PencilIcon data-icon="inline-start" />
                  Edit
                </Link>
              </Button>
            )}
            {forward && (
              <Button
                size="lg"
                disabled={controls.isBusy}
                onClick={() => controls.changeStatus(tripRef(trip), forward)}
              >
                {STATUS_ACTION_LABEL[forward]}
              </Button>
            )}
            {menu.length > 0 && <RowActions label={trip.code} actions={menu} />}
          </>
        }
      />

      {trip.status === "cancelled" && (
        <Alert variant="destructive" className="bg-destructive/5">
          <BanIcon />
          <AlertDescription>
            Cancelled{trip.cancelled_at && ` on ${formatDateTime(trip.cancelled_at)}`}
            {trip.cancellation_reason ? ` — ${trip.cancellation_reason}` : "."}
          </AlertDescription>
        </Alert>
      )}
      {!trip.active && isOpenTrip(trip) && (
        <Alert>
          <EyeOffIcon />
          <AlertDescription>
            This trip is off sale. Passengers can’t find or book it until you put it back on sale.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-7">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">{stat.label}</p>
            <p className="font-heading text-xl font-bold tabular-nums">{stat.value}</p>
            <p className="truncate text-xs text-muted-foreground">{stat.hint}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr] lg:items-start">
        <Card>
          <CardHeader>
            <CardTitle>Stop timings</CardTitle>
            <CardDescription>Estimated arrival and departure at every stop (Sri Lanka time).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <TripTimeline trip={trip} />
            {trip.status === "scheduled" && (
              <div className="border-t pt-4">
                <Button
                  variant="outline"
                  size="lg"
                  disabled={resetTimings.isPending}
                  onClick={() => resetTimings.mutate()}
                >
                  <RotateCcwIcon data-icon="inline-start" />
                  Reset to route timetable
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Route</CardTitle>
            </CardHeader>
            <CardContent>
              <DetailList
                items={[
                  {
                    label: "Route",
                    wide: true,
                    value: (
                      <Link href={`/admin/routes/${route.id}`} className={linkClass}>
                        {route.name}
                      </Link>
                    ),
                  },
                  { label: "From", value: route.origin.name },
                  { label: "To", value: route.destination.name },
                  { label: "Route number", value: route.route_number || "—" },
                  { label: "Standard fare", value: route.base_fare ? formatCurrency(route.base_fare) : "—" },
                ]}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Bus</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <DetailList
                items={[
                  {
                    label: "Bus",
                    value: (
                      <Link href={`/admin/buses/${bus.id}`} className={linkClass}>
                        {bus.name}
                      </Link>
                    ),
                  },
                  { label: "Registration", value: <span className="font-mono">{bus.registration_number}</span> },
                  { label: "Type", value: BUS_TYPE_LABEL[bus.bus_type] },
                  { label: "Seat capacity", value: bus.seat_capacity },
                  {
                    label: "Seat layout",
                    value: bus.seat_layout ? (
                      <Link href={`/admin/seat-layouts/${bus.seat_layout}`} className={linkClass}>
                        {bus.seat_layout_name}
                      </Link>
                    ) : (
                      "—"
                    ),
                  },
                  {
                    label: "Operator",
                    value: (
                      <Link href={`/admin/operators/${trip.operator}`} className={linkClass}>
                        {trip.operator_name}
                      </Link>
                    ),
                  },
                ]}
              />
              <FacilityList facilities={bus.facilities} compact />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Record</CardTitle>
            </CardHeader>
            <CardContent>
              <DetailList
                items={[
                  {
                    label: "Created from",
                    wide: true,
                    value: trip.schedule ? (
                      <Link
                        href={`/admin/schedules/${trip.schedule}`}
                        className={`${linkClass} inline-flex items-center gap-1.5`}
                      >
                        <RepeatIcon className="size-4" aria-hidden />
                        Recurring schedule
                      </Link>
                    ) : (
                      "One-time trip"
                    ),
                  },
                  { label: "Created", value: formatDate(trip.created_at) },
                  { label: "Last updated", value: formatDate(trip.updated_at) },
                ]}
              />
            </CardContent>
          </Card>
        </div>
      </div>
      {controls.dialogs}
    </div>
  );
}
