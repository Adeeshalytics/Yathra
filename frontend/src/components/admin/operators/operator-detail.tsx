"use client";

import { useQuery } from "@tanstack/react-query";
import { BusFrontIcon, PencilIcon, PowerIcon, PowerOffIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { DetailList } from "@/components/admin/shared/detail-list";
import { BackLink, DetailSkeleton, RecordError } from "@/components/admin/shared/page-parts";
import { useRecordControls } from "@/components/admin/shared/record-controls";
import { DataTable, type DataTableColumn } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ActiveBadge, StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { adminApi } from "@/lib/api/admin";
import type { AdminBus } from "@/lib/api/admin-types";
import { queryKeys } from "@/lib/api/query-keys";
import { formatDate } from "@/lib/format";
import { BUS_TYPES } from "@/lib/validations/admin";

const BUS_TYPE_LABEL = Object.fromEntries(BUS_TYPES.map((t) => [t.value, t.label]));

const BUS_COLUMNS: DataTableColumn<AdminBus>[] = [
  {
    id: "bus",
    header: "Bus",
    cell: (bus) => (
      <div>
        <Link href={`/admin/buses/${bus.id}`} className="font-medium hover:underline">
          {bus.name}
        </Link>
        <p className="font-mono text-xs text-muted-foreground">{bus.registration_number}</p>
      </div>
    ),
  },
  { id: "type", header: "Type", cell: (bus) => BUS_TYPE_LABEL[bus.bus_type] },
  { id: "seats", header: "Seats", className: "text-right", cell: (bus) => bus.seat_capacity },
  { id: "status", header: "Status", cell: (bus) => <ActiveBadge active={bus.active} /> },
];

export function OperatorDetail({ id }: { id: string }) {
  const router = useRouter();
  const query = useQuery({
    queryKey: queryKeys.admin.detail("operators", id),
    queryFn: ({ signal }) => adminApi.operators.get(id, signal),
  });
  const busParams = { operator: id, page_size: 50 };
  const buses = useQuery({
    queryKey: queryKeys.admin.list("buses", busParams),
    queryFn: ({ signal }) => adminApi.buses.list(busParams, signal),
  });
  const controls = useRecordControls("operators", adminApi.operators, "operator");

  if (query.isPending) return <DetailSkeleton />;
  if (query.isError) {
    return (
      <RecordError
        error={query.error}
        noun="operator"
        backHref="/admin/operators"
        onRetry={() => void query.refetch()}
      />
    );
  }

  const operator = query.data;
  const record = { id: operator.id, label: operator.company_name };

  return (
    <div className="space-y-6">
      <BackLink href="/admin/operators">Operators</BackLink>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {operator.company_name}
            <StatusBadge status={operator.status} />
          </span>
        }
        description={`Registration ${operator.registration_number}`}
        actions={
          <>
            <Button asChild variant="outline" size="lg">
              <Link href={`/admin/operators/${id}/edit`}>
                <PencilIcon data-icon="inline-start" />
                Edit
              </Link>
            </Button>
            {operator.status === "active" ? (
              <Button
                variant="outline"
                size="lg"
                disabled={controls.isBusy}
                onClick={() =>
                  controls.requestDeactivate(
                    record,
                    "Suspended operators can’t be assigned new buses. Existing data is kept.",
                  )
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
                  description:
                    "This permanently removes the operator. Staff accounts linked to it lose access. Operators that still own buses can’t be deleted.",
                  onDeleted: () => router.push("/admin/operators"),
                })
              }
            >
              <Trash2Icon data-icon="inline-start" />
              Delete
            </Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr] lg:items-start">
        <Card>
          <CardHeader>
            <CardTitle>Company details</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList
              items={[
                { label: "Email", value: operator.contact_email },
                { label: "Phone", value: operator.contact_phone },
                { label: "Address", value: operator.address, wide: true },
                { label: "Added", value: formatDate(operator.created_at) },
                { label: "Last updated", value: formatDate(operator.updated_at) },
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>At a glance</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-3 text-center">
            {[
              ["Buses", operator.bus_count],
              ["Active", operator.active_bus_count],
              ["Staff", operator.member_count],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-muted/60 p-4">
                <p className="font-heading text-2xl font-bold tabular-nums">{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Fleet</CardTitle>
          <CardDescription>Buses registered to this operator.</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            caption={`Buses operated by ${operator.company_name}`}
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
                title="No buses yet"
                description="Buses you add for this operator will appear here."
                action={
                  <Button asChild>
                    <Link href="/admin/buses/new">Add a bus</Link>
                  </Button>
                }
              />
            }
          />
        </CardContent>
      </Card>
      {controls.dialog}
    </div>
  );
}
