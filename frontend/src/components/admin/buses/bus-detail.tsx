"use client";

import { useQuery } from "@tanstack/react-query";
import { Grid3x3Icon, PencilIcon, PowerIcon, PowerOffIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { DetailList } from "@/components/admin/shared/detail-list";
import { BackLink, DetailSkeleton, RecordError } from "@/components/admin/shared/page-parts";
import { useRecordControls } from "@/components/admin/shared/record-controls";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ActiveBadge } from "@/components/common/status-badge";
import { SeatLegend, SeatMap } from "@/components/seats/seat-map";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { adminApi } from "@/lib/api/admin";
import { queryKeys } from "@/lib/api/query-keys";
import { formatDate } from "@/lib/format";

import { BUS_TYPE_LABEL } from "./buses-list";
import { FacilityList } from "./facilities";

export function BusDetail({ id }: { id: string }) {
  const router = useRouter();
  const query = useQuery({
    queryKey: queryKeys.admin.detail("buses", id),
    queryFn: ({ signal }) => adminApi.buses.get(id, signal),
  });
  const layoutId = query.data?.seat_layout ?? null;
  const layout = useQuery({
    queryKey: queryKeys.admin.detail("seat-layouts", layoutId ?? "none"),
    queryFn: ({ signal }) => adminApi.seatLayouts.get(layoutId as string, signal),
    enabled: layoutId !== null,
  });
  const controls = useRecordControls("buses", adminApi.buses, "bus");

  if (query.isPending) return <DetailSkeleton />;
  if (query.isError) {
    return (
      <RecordError error={query.error} noun="bus" backHref="/admin/buses" onRetry={() => void query.refetch()} />
    );
  }

  const bus = query.data;
  const record = { id: bus.id, label: bus.registration_number };

  return (
    <div className="space-y-6">
      <BackLink href="/admin/buses">Buses</BackLink>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {bus.name}
            <ActiveBadge active={bus.active} />
          </span>
        }
        description={<span className="font-mono">{bus.registration_number}</span>}
        actions={
          <>
            <Button asChild variant="outline" size="lg">
              <Link href={`/admin/buses/${id}/edit`}>
                <PencilIcon data-icon="inline-start" />
                Edit
              </Link>
            </Button>
            {bus.active ? (
              <Button
                variant="outline"
                size="lg"
                disabled={controls.isBusy}
                onClick={() => controls.requestDeactivate(record)}
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
                  description:
                    "This permanently removes the bus. Buses with trips on record can’t be deleted — deactivate them instead.",
                  onDeleted: () => router.push("/admin/buses"),
                })
              }
            >
              <Trash2Icon data-icon="inline-start" />
              Delete
            </Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-start">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <DetailList
                items={[
                  {
                    label: "Operator",
                    value: (
                      <Link href={`/admin/operators/${bus.operator}`} className="text-primary hover:underline">
                        {bus.operator_name}
                      </Link>
                    ),
                  },
                  { label: "Bus type", value: BUS_TYPE_LABEL[bus.bus_type] },
                  { label: "Seats for sale", value: bus.seat_capacity },
                  { label: "Trips on record", value: bus.trip_count },
                  { label: "Added", value: formatDate(bus.created_at) },
                  { label: "Last updated", value: formatDate(bus.updated_at) },
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Facilities</CardTitle>
            </CardHeader>
            <CardContent>
              <FacilityList facilities={bus.facilities} />
            </CardContent>
          </Card>
        </div>

        <Card className="lg:w-[26rem]">
          <CardHeader>
            <CardTitle>Seat layout</CardTitle>
            <CardDescription>
              {bus.seat_layout_name ? (
                <Link href={`/admin/seat-layouts/${bus.seat_layout}`} className="text-primary hover:underline">
                  {bus.seat_layout_name}
                </Link>
              ) : (
                "No layout assigned"
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!layoutId && (
              <EmptyState
                icon={Grid3x3Icon}
                title="No seat layout"
                description="Assign a layout so passengers can choose seats."
                action={
                  <Button asChild variant="outline">
                    <Link href={`/admin/buses/${id}/edit`}>Assign a layout</Link>
                  </Button>
                }
              />
            )}
            {layoutId && layout.isPending && <Skeleton className="h-96 w-full rounded-2xl" />}
            {layout.data && (
              <>
                <div className="overflow-x-auto">
                  <SeatMap
                    rows={layout.data.rows}
                    columns={layout.data.columns}
                    seats={layout.data.seats}
                    label={`Seat map for ${bus.name}`}
                  />
                </div>
                <SeatLegend />
              </>
            )}
          </CardContent>
        </Card>
      </div>
      {controls.dialog}
    </div>
  );
}
