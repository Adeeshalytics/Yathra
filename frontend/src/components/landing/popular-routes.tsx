"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRightIcon, ClockIcon, MapPinIcon, RouteIcon } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { catalogApi } from "@/lib/api/endpoints";
import { queryKeys } from "@/lib/api/query-keys";
import type { Route } from "@/lib/api/types";
import { formatCurrency, formatDuration, todayInSriLanka } from "@/lib/format";
import { searchHref } from "@/lib/validations/search";

import { SectionHeading } from "./section-heading";

const ROUTE_PARAMS = { page_size: 6 };

function RouteCard({ route }: { route: Route }) {
  const href = searchHref({
    from: route.origin.id,
    to: route.destination.id,
    date: todayInSriLanka(),
    passengers: "1",
  });
  const duration = formatDuration(route.duration_minutes);

  return (
    <Link
      href={href}
      className="group rounded-2xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      aria-label={`${route.origin.city} to ${route.destination.city}: view departures`}
    >
      <Card className="h-full rounded-2xl transition-all group-hover:-translate-y-0.5 group-hover:shadow-lg group-hover:ring-primary/30">
        <CardContent className="flex h-full flex-col gap-5">
          <div className="flex items-center justify-between gap-2">
            <Badge variant="secondary">
              {route.route_number ? `Route ${route.route_number}` : "Intercity"}
            </Badge>
            {duration && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <ClockIcon className="size-3.5" aria-hidden />
                {duration}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">From</p>
              <p className="truncate font-heading text-lg font-bold">{route.origin.city}</p>
            </div>
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-primary">
              <ArrowRightIcon className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1 text-right">
              <p className="text-xs text-muted-foreground">To</p>
              <p className="truncate font-heading text-lg font-bold">{route.destination.city}</p>
            </div>
          </div>
          <div className="mt-auto flex items-end justify-between border-t pt-4">
            <p className="flex items-center gap-1 text-sm text-muted-foreground">
              <MapPinIcon className="size-3.5" aria-hidden />
              {route.stop_count} stops
            </p>
            {route.starting_fare ? (
              <p className="text-sm text-muted-foreground">
                from{" "}
                <span className="font-heading text-lg font-bold text-foreground">
                  {formatCurrency(route.starting_fare)}
                </span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">No departures scheduled</p>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function RouteCardSkeleton() {
  return (
    <div className="space-y-5 rounded-2xl border bg-card p-4">
      <div className="flex justify-between">
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-4 w-14" />
      </div>
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-10 w-24" />
        <Skeleton className="size-8 rounded-full" />
        <Skeleton className="h-10 w-24" />
      </div>
      <Skeleton className="h-8 w-full" />
    </div>
  );
}

export function PopularRoutes() {
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: queryKeys.routes(ROUTE_PARAMS),
    queryFn: ({ signal }) => catalogApi.routes(ROUTE_PARAMS, signal),
  });

  return (
    <section
      id="popular-routes"
      aria-labelledby="popular-routes-heading"
      className="scroll-mt-20 py-16 sm:py-24"
    >
      <div className="container-page">
        <SectionHeading
          id="popular-routes-heading"
          eyebrow="Popular routes"
          title="Where Sri Lanka is travelling"
          description="Daily intercity services on the island’s busiest corridors."
        />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy={isPending}>
          {isPending &&
            Array.from({ length: ROUTE_PARAMS.page_size }, (_, index) => (
              <RouteCardSkeleton key={index} />
            ))}
          {isError && (
            <ErrorState
              className="sm:col-span-2 lg:col-span-3"
              title="Routes couldn’t be loaded"
              error={error}
              onRetry={() => void refetch()}
            />
          )}
          {data && data.results.length === 0 && (
            <EmptyState
              className="sm:col-span-2 lg:col-span-3"
              icon={RouteIcon}
              title="No routes yet"
              description="Routes will appear here as operators publish their timetables."
            />
          )}
          {data?.results.map((route) => <RouteCard key={route.id} route={route} />)}
        </div>
      </div>
    </section>
  );
}
