import { ArrowRightIcon, ChevronDownIcon, MapPinIcon, SnowflakeIcon } from "lucide-react";
import Link from "next/link";

import { FacilityList } from "@/components/admin/buses/facilities";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { StopTime, TripSearchResult } from "@/lib/api/trip-types";
import { dayShift, formatClock, formatJourney } from "@/lib/datetime";
import { formatCurrency, pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { tripHref } from "@/lib/validations/search";

const LOW_SEATS = 5;

function PointList({ title, points, highlight }: { title: string; points: StopTime[]; highlight: number }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold text-muted-foreground uppercase">{title}</p>
      <ul className="space-y-1">
        {points.map((point) => (
          <li
            key={point.sequence}
            className={cn("flex justify-between gap-3", point.sequence === highlight && "font-medium text-foreground")}
          >
            <span className="truncate">{point.stop.name}</span>
            <span className="shrink-0 tabular-nums">{formatClock(point.time)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BusCard({
  trip,
  passengers,
  backQuery,
}: {
  trip: TripSearchResult;
  passengers: number;
  /** The current search's query string, so the trip page can link back to these results. */
  backQuery?: string;
}) {
  const arrivesLater = dayShift(trip.boarding.time, trip.dropoff.time);
  const between = trip.dropoff.sequence - trip.boarding.sequence - 1;
  const fewSeats = trip.available_seats <= LOW_SEATS;
  const titleId = `trip-${trip.id}-title`;

  return (
    <article
      aria-labelledby={titleId}
      className="@container rounded-2xl border bg-card p-4 shadow-xs transition-shadow hover:shadow-md sm:p-5"
    >
      {/* Laid out by the card's own width (container queries), not the window's. */}
      <div className="flex flex-col gap-5 @3xl:flex-row">
        {/* Operator & bus */}
        <div className="space-y-2 @3xl:w-48 @3xl:shrink-0">
          <p className="text-xs font-medium text-muted-foreground">{trip.operator.name}</p>
          <h3 id={titleId} className="font-heading text-lg leading-tight font-bold">
            {trip.bus.name}
          </h3>
          <p className="font-mono text-xs text-muted-foreground">{trip.bus.registration_number}</p>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="secondary">{trip.bus.bus_type_label}</Badge>
            {trip.bus.is_ac && trip.bus.bus_type !== "ac" && (
              <Badge variant="outline" className="gap-1">
                <SnowflakeIcon aria-hidden />
                AC
              </Badge>
            )}
          </div>
        </div>

        {/* Journey */}
        <div className="min-w-0 flex-1 space-y-3">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            {trip.route.origin.city}
            <ArrowRightIcon className="size-3.5 text-muted-foreground" aria-label="to" />
            {trip.route.destination.city}
          </p>
          <div className="flex items-center gap-3">
            <div>
              <p className="font-heading text-xl font-bold whitespace-nowrap tabular-nums @md:text-2xl">
                {formatClock(trip.boarding.time)}
              </p>
              <p className="max-w-32 truncate text-xs text-muted-foreground">{trip.boarding.stop.name}</p>
            </div>
            <div className="flex min-w-16 flex-1 flex-col items-center gap-1 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{formatJourney(trip.duration_minutes)}</span>
              <span aria-hidden className="relative h-0.5 w-full rounded bg-border">
                <span className="absolute top-1/2 left-0 size-2 -translate-y-1/2 rounded-full bg-primary" />
                <span className="absolute top-1/2 right-0 size-2 -translate-y-1/2 rounded-full border-2 border-primary bg-card" />
              </span>
              <span>{between > 0 ? pluralize(between, "stop") : "Direct"}</span>
            </div>
            <div className="text-right">
              <p className="font-heading text-xl font-bold whitespace-nowrap tabular-nums @md:text-2xl">
                {formatClock(trip.dropoff.time)}
                {arrivesLater > 0 && (
                  <sup className="ml-0.5 text-xs font-semibold text-primary" title="Arrives the next day">
                    +{arrivesLater}
                  </sup>
                )}
              </p>
              <p className="max-w-32 truncate text-xs text-muted-foreground">{trip.dropoff.stop.name}</p>
            </div>
          </div>
          {trip.bus.facilities.length > 0 && <FacilityList facilities={trip.bus.facilities} compact />}
          <details className="group rounded-xl bg-muted/50 text-sm">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">
              <MapPinIcon className="size-3.5" aria-hidden />
              {pluralize(trip.boarding_points.length, "boarding point")} ·{" "}
              {pluralize(trip.dropoff_points.length, "drop-off point")}
              <ChevronDownIcon className="ml-auto size-4 transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <div className="grid gap-4 px-3 pt-1 pb-3 text-muted-foreground sm:grid-cols-2">
              <PointList title="Boarding points" points={trip.boarding_points} highlight={trip.boarding.sequence} />
              <PointList title="Drop-off points" points={trip.dropoff_points} highlight={trip.dropoff.sequence} />
            </div>
          </details>
        </div>

        {/* Price & action */}
        <div className="flex items-end justify-between gap-4 border-t pt-4 @3xl:w-40 @3xl:shrink-0 @3xl:flex-col @3xl:items-end @3xl:border-t-0 @3xl:border-l @3xl:pt-0 @3xl:pl-5">
          <div className="@3xl:text-right">
            <p className="text-xs text-muted-foreground">Starting from</p>
            <p className="font-heading text-2xl font-bold tabular-nums">{formatCurrency(trip.price)}</p>
            <p className="text-xs text-muted-foreground">
              per seat
              {passengers > 1 && ` · ${formatCurrency(Number(trip.price) * passengers)} for ${passengers}`}
            </p>
            <p className={cn("mt-2 text-sm font-medium", fewSeats ? "text-amber-700" : "text-emerald-700")}>
              {fewSeats
                ? `Only ${pluralize(trip.available_seats, "seat")} left`
                : `${trip.available_seats} seats available`}
            </p>
          </div>
          <Button asChild variant="cta" size="lg" className="shrink-0">
            <Link
              href={tripHref(trip.id, {
                passengers,
                boarding: trip.boarding.stop.id,
                dropoff: trip.dropoff.stop.id,
                search: backQuery,
              })}
              aria-label={`Select seats on ${trip.bus.name}, ${formatClock(trip.boarding.time)}`}
            >
              Select seats
            </Link>
          </Button>
        </div>
      </div>
    </article>
  );
}

export function BusCardSkeleton() {
  return (
    <div className="flex flex-col gap-5 rounded-2xl border bg-card p-5 md:flex-row" aria-hidden>
      <div className="space-y-2 md:w-52">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-5 w-24 rounded-full" />
      </div>
      <div className="flex-1 space-y-3">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-8 w-full rounded-xl" />
      </div>
      <div className="space-y-2 md:w-44">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-9 w-full" />
      </div>
    </div>
  );
}
