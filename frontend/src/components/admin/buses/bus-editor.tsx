"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { BackLink, DetailSkeleton, RecordError } from "@/components/admin/shared/page-parts";
import { PageHeader } from "@/components/common/page-header";
import { useAdminMutation } from "@/hooks/use-admin-mutation";
import { adminApi } from "@/lib/api/admin";
import type { BusPayload } from "@/lib/api/admin-types";
import { queryKeys } from "@/lib/api/query-keys";

import { BusForm } from "./bus-form";

export function BusCreateView() {
  const router = useRouter();
  const create = useAdminMutation({
    mutationFn: (payload: BusPayload) => adminApi.buses.create(payload),
    successMessage: (bus) => `${bus.registration_number} was added to the fleet.`,
    toastErrors: false,
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <BackLink href="/admin/buses">Buses</BackLink>
      <PageHeader title="Add bus" description="Register a vehicle and assign it to an operator." />
      <BusForm
        submitLabel="Create bus"
        onSubmit={async (payload) => {
          const bus = await create.mutateAsync(payload);
          router.push(`/admin/buses/${bus.id}`);
        }}
        onCancel={() => router.push("/admin/buses")}
      />
    </div>
  );
}

export function BusEditView({ id }: { id: string }) {
  const router = useRouter();
  const query = useQuery({
    queryKey: queryKeys.admin.detail("buses", id),
    queryFn: ({ signal }) => adminApi.buses.get(id, signal),
  });
  const update = useAdminMutation({
    mutationFn: (payload: BusPayload) => adminApi.buses.update(id, payload),
    successMessage: (bus) => `${bus.registration_number} was updated.`,
    toastErrors: false,
  });

  if (query.isPending) return <DetailSkeleton />;
  if (query.isError) {
    return (
      <RecordError
        error={query.error}
        noun="bus"
        backHref="/admin/buses"
        onRetry={() => void query.refetch()}
      />
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <BackLink href={`/admin/buses/${id}`}>{query.data.name}</BackLink>
      <PageHeader title="Edit bus" description={query.data.registration_number} />
      <BusForm
        bus={query.data}
        submitLabel="Save changes"
        onSubmit={async (payload) => {
          await update.mutateAsync(payload);
          router.push(`/admin/buses/${id}`);
        }}
        onCancel={() => router.push(`/admin/buses/${id}`)}
      />
    </div>
  );
}
