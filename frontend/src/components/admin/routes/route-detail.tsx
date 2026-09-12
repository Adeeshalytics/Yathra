"use client";

import { useQuery } from "@tanstack/react-query";
import { PencilIcon, PowerIcon, PowerOffIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { DetailList } from "@/components/admin/shared/detail-list";
import { BackLink, DetailSkeleton, RecordError } from "@/components/admin/shared/page-parts";
import { useRecordControls } from "@/components/admin/shared/record-controls";
import { PageHeader } from "@/components/common/page-header";
import { ActiveBadge } from "@/components/common/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { adminApi } from "@/lib/api/admin";
import type { AdminRouteStop } from "@/lib/api/admin-types";
import { queryKeys } from "@/lib/api/query-keys";
import { formatCurrency, formatDate, formatDuration, formatOffset } from "@/lib/format";
import { cn } from "@/lib/utils";

function Timeline({ stops }: { stops: AdminRouteStop[] }) {
  const last = stops.length - 1;
  return (
    <ol aria-label="Stops in travel order">
      {stops.map((stop, index) => {
        const dwell = stop.departure_offset_minutes - stop.arrival_offset_minutes;
        return (
          <li key={stop.sequence} className="relative flex gap-4 pb-6 last:pb-0">
            {index < last && <span aria-hidden className="absolute top-9 bottom-1 left-[15px] w-0.5 bg-border" />}
            <span
              className={cn(
                "relative z-10 grid size-8 shrink-0 place-items-center rounded-full border-2 text-xs font-semibold",
                index === 0 || index === last
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-primary/40 bg-card text-primary",
              )}
            >
              {stop.sequence}
            </span>
            <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">
                  {stop.stop.name}
                  {!stop.stop.active && (
                    <Badge variant="outline" className="ml-2">
                      Inactive stop
                    </Badge>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">{stop.stop.city}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {stop.is_boarding_point && <Badge variant="secondary">Boarding</Badge>}
                  {stop.is_dropoff_point && <Badge variant="secondary">Drop-off</Badge>}
                </div>
              </div>
              <div className="text-right text-sm tabular-nums">
                <p className="font-medium">
                  {index === 0 ? "Departs +0:00" : `Arrives ${formatOffset(stop.arrival_offset_minutes)}`}
                </p>
                {index > 0 && dwell > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Leaves {formatOffset(stop.departure_offset_minutes)} ({dwell} min stop)
                  </p>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function RouteDetail({ id }: { id: string }) {
  const router = useRouter();
  const query = useQuery({
    queryKey: queryKeys.admin.detail("routes", id),
    queryFn: ({ signal }) => adminApi.routes.get(id, signal),
  });
  const controls = useRecordControls("routes", adminApi.routes, "route");

  if (query.isPending) return <DetailSkeleton />;
  if (query.isError) {
    return (
      <RecordError error={query.error} noun="route" backHref="/admin/routes" onRetry={() => void query.refetch()} />
    );
  }

  const route = query.data;
  const record = { id: route.id, label: route.name };

  return (
    <div className="space-y-6">
      <BackLink href="/admin/routes">Routes</BackLink>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {route.name}
            {route.route_number && <Badge variant="secondary">Route {route.route_number}</Badge>}
            <ActiveBadge active={route.active} />
          </span>
        }
        description={`${route.origin.name} to ${route.destination.name}`}
        actions={
          <>
            <Button asChild variant="outline" size="lg">
              <Link href={`/admin/routes/${id}/edit`}>
                <PencilIcon data-icon="inline-start" />
                Edit
              </Link>
            </Button>
            {route.active ? (
              <Button
                variant="outline"
                size="lg"
                disabled={controls.isBusy}
                onClick={() => controls.requestDeactivate(record, "The route is hidden from passengers until you activate it again.")}
              >
                <PowerOffIcon data-icon="inline-start" />
                Deactivate
              </Button>
            ) : (
              <Button size="lg" disabled={controls.isBusy} onClick={() => controls.activate(record)}>
                <PowerIcon data-icon="inline-start" />
                Activate
              </Button>
            )}
            <Button
              variant="destructive"
              size="lg"
              disabled={controls.isBusy}
              onClick={() =>
                controls.requestDelete(record, {
                  description: "This permanently removes the route and its stop list. Routes with trips can’t be deleted.",
                  onDeleted: () => router.push("/admin/routes"),
                })
              }
            >
              <Trash2Icon data-icon="inline-start" />
              Delete
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Stops", route.stop_count],
          ["Journey time", formatDuration(route.duration_minutes) ?? "—"],
          ["Standard fare", route.base_fare ? formatCurrency(route.base_fare) : "—"],
          ["Trips", route.trip_count],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="font-heading text-xl font-bold tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr] lg:items-start">
        <Card>
          <CardHeader>
            <CardTitle>Timetable</CardTitle>
            <CardDescription>Times are after the bus leaves {route.origin.name}.</CardDescription>
          </CardHeader>
          <CardContent>
            <Timeline stops={route.stops} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList
              className="sm:grid-cols-1"
              items={[
                { label: "Description", value: route.description || "—" },
                { label: "Created", value: formatDate(route.created_at) },
                { label: "Last updated", value: formatDate(route.updated_at) },
              ]}
            />
          </CardContent>
        </Card>
      </div>
      {controls.dialog}
    </div>
  );
}
