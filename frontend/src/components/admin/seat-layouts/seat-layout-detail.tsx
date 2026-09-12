"use client";

import { useQuery } from "@tanstack/react-query";
import { BusFrontIcon, PencilIcon, PowerIcon, PowerOffIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { BackLink, DetailSkeleton, RecordError } from "@/components/admin/shared/page-parts";
import { useRecordControls } from "@/components/admin/shared/record-controls";
import { DataTable, type DataTableColumn } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ActiveBadge } from "@/components/common/status-badge";
import { SeatLegend, SeatMap } from "@/components/seats/seat-map";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { adminApi } from "@/lib/api/admin";
import type { AdminBus } from "@/lib/api/admin-types";
import { queryKeys } from "@/lib/api/query-keys";
import { countSeats } from "@/lib/seat-layout";

import { LAYOUT_TYPE_LABEL } from "./seat-layouts-list";

const BUS_COLUMNS: DataTableColumn<AdminBus>[] = [
  {
    id: "bus",
    header: "Bus",
    cell: (bus) => (
      <Link href={`/admin/buses/${bus.id}`} className="font-medium hover:underline">
        {bus.name} <span className="font-mono text-xs text-muted-foreground">{bus.registration_number}</span>
      </Link>
    ),
  },
  { id: "operator", header: "Operator", cell: (bus) => bus.operator_name },
  { id: "capacity", header: "Seats sold", className: "text-right", cell: (bus) => bus.seat_capacity },
];

export function SeatLayoutDetail({ id }: { id: string }) {
  const router = useRouter();
  const query = useQuery({
    queryKey: queryKeys.admin.detail("seat-layouts", id),
    queryFn: ({ signal }) => adminApi.seatLayouts.get(id, signal),
  });
  const busParams = { seat_layout: id, page_size: 50 };
  const buses = useQuery({
    queryKey: queryKeys.admin.list("buses", busParams),
    queryFn: ({ signal }) => adminApi.buses.list(busParams, signal),
  });
  const controls = useRecordControls("seat-layouts", adminApi.seatLayouts, "seat layout");

  if (query.isPending) return <DetailSkeleton />;
  if (query.isError) {
    return (
      <RecordError
        error={query.error}
        noun="seat layout"
        backHref="/admin/seat-layouts"
        onRetry={() => void query.refetch()}
      />
    );
  }

  const layout = query.data;
  const stats = countSeats(layout.seats);
  const record = { id: layout.id, label: layout.name };

  return (
    <div className="space-y-6">
      <BackLink href="/admin/seat-layouts">Seat layouts</BackLink>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {layout.name}
            <ActiveBadge active={layout.active} />
          </span>
        }
        description={layout.description || `${LAYOUT_TYPE_LABEL[layout.layout_type]} seating`}
        actions={
          <>
            <Button asChild variant="outline" size="lg">
              <Link href={`/admin/seat-layouts/${id}/edit`}>
                <PencilIcon data-icon="inline-start" />
                Edit layout
              </Link>
            </Button>
            {layout.active ? (
              <Button
                variant="outline"
                size="lg"
                disabled={controls.isBusy}
                onClick={() =>
                  controls.requestDeactivate(record, "Buses already using it keep it; it just can’t be assigned to more buses.")
                }
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
                  description: "This permanently removes the layout and its seats. Layouts used by buses can’t be deleted.",
                  onDeleted: () => router.push("/admin/seat-layouts"),
                })
              }
            >
              <Trash2Icon data-icon="inline-start" />
              Delete
            </Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[auto_1fr] lg:items-start">
        <Card>
          <CardContent className="space-y-4">
            <div className="overflow-x-auto">
              <SeatMap rows={layout.rows} columns={layout.columns} seats={layout.seats} label={layout.name} />
            </div>
            <SeatLegend className="max-w-80" />
          </CardContent>
        </Card>
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Pattern", LAYOUT_TYPE_LABEL[layout.layout_type]],
              ["Grid", `${layout.rows} × ${layout.columns}`],
              ["Passenger seats", stats.seatCount],
              ["Bookable", stats.bookableCount],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border bg-card p-4">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="font-heading text-xl font-bold tabular-nums">{value}</p>
              </div>
            ))}
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Buses using this layout</CardTitle>
              <CardDescription>Editing the layout changes the seat map for all of them.</CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable
                caption={`Buses using ${layout.name}`}
                columns={BUS_COLUMNS}
                data={buses.data?.results}
                getRowId={(bus) => bus.id}
                isLoading={buses.isPending}
                error={buses.error}
                onRetry={() => void buses.refetch()}
                loadingRows={2}
                emptyState={
                  <EmptyState
                    icon={BusFrontIcon}
                    title="Not assigned yet"
                    description="Assign this layout from a bus’s edit page."
                  />
                }
              />
            </CardContent>
          </Card>
        </div>
      </div>
      {controls.dialog}
    </div>
  );
}
