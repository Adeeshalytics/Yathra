"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { BackLink, DetailSkeleton, RecordError } from "@/components/admin/shared/page-parts";
import { PageHeader } from "@/components/common/page-header";
import { useAdminMutation } from "@/hooks/use-admin-mutation";
import { adminApi } from "@/lib/api/admin";
import type { SeatLayoutPayload } from "@/lib/api/admin-types";
import { queryKeys } from "@/lib/api/query-keys";

import { SeatLayoutEditor } from "./seat-layout-editor";

export function SeatLayoutCreateView() {
  const router = useRouter();
  const create = useAdminMutation({
    mutationFn: (payload: SeatLayoutPayload) => adminApi.seatLayouts.create(payload),
    successMessage: (layout) => `${layout.name} was created.`,
    toastErrors: false,
  });

  return (
    <div className="space-y-6">
      <BackLink href="/admin/seat-layouts">Seat layouts</BackLink>
      <PageHeader
        title="New seat layout"
        description="Design a reusable seat map. Buses that use it will show this grid to passengers."
      />
      <SeatLayoutEditor
        submitLabel="Create layout"
        onSubmit={async (payload) => {
          const layout = await create.mutateAsync(payload);
          router.push(`/admin/seat-layouts/${layout.id}`);
        }}
        onCancel={() => router.push("/admin/seat-layouts")}
      />
    </div>
  );
}

export function SeatLayoutEditView({ id }: { id: string }) {
  const router = useRouter();
  const query = useQuery({
    queryKey: queryKeys.admin.detail("seat-layouts", id),
    queryFn: ({ signal }) => adminApi.seatLayouts.get(id, signal),
  });
  const update = useAdminMutation({
    mutationFn: (payload: SeatLayoutPayload) => adminApi.seatLayouts.update(id, payload),
    successMessage: (layout) => `${layout.name} was saved.`,
    toastErrors: false,
  });

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

  return (
    <div className="space-y-6">
      <BackLink href={`/admin/seat-layouts/${id}`}>{query.data.name}</BackLink>
      <PageHeader
        title="Edit seat layout"
        description={
          query.data.bus_count > 0
            ? `Used by ${query.data.bus_count} bus${query.data.bus_count === 1 ? "" : "es"}; changes apply to all of them.`
            : "Not assigned to any bus yet."
        }
      />
      <SeatLayoutEditor
        layout={query.data}
        submitLabel="Save layout"
        onSubmit={async (payload) => {
          await update.mutateAsync(payload);
          router.push(`/admin/seat-layouts/${id}`);
        }}
        onCancel={() => router.push(`/admin/seat-layouts/${id}`)}
      />
    </div>
  );
}
