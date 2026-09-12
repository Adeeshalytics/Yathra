"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { BackLink, DetailSkeleton, RecordError } from "@/components/admin/shared/page-parts";
import { PageHeader } from "@/components/common/page-header";
import { useAdminMutation } from "@/hooks/use-admin-mutation";
import { adminApi } from "@/lib/api/admin";
import type { RoutePayload } from "@/lib/api/admin-types";
import { queryKeys } from "@/lib/api/query-keys";

import { RouteForm } from "./route-form";

export function RouteCreateView() {
  const router = useRouter();
  const create = useAdminMutation({
    mutationFn: (payload: RoutePayload) => adminApi.routes.create(payload),
    successMessage: (route) => `${route.name} was created.`,
    toastErrors: false,
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink href="/admin/routes">Routes</BackLink>
      <PageHeader title="New route" description="Define the path buses take and when they reach each stop." />
      <RouteForm
        submitLabel="Create route"
        onSubmit={async (payload) => {
          const route = await create.mutateAsync(payload);
          router.push(`/admin/routes/${route.id}`);
        }}
        onCancel={() => router.push("/admin/routes")}
      />
    </div>
  );
}

export function RouteEditView({ id }: { id: string }) {
  const router = useRouter();
  const query = useQuery({
    queryKey: queryKeys.admin.detail("routes", id),
    queryFn: ({ signal }) => adminApi.routes.get(id, signal),
  });
  const update = useAdminMutation({
    mutationFn: (payload: RoutePayload) => adminApi.routes.update(id, payload),
    successMessage: (route) => `${route.name} was saved.`,
    toastErrors: false,
  });

  if (query.isPending) return <DetailSkeleton />;
  if (query.isError) {
    return (
      <RecordError error={query.error} noun="route" backHref="/admin/routes" onRetry={() => void query.refetch()} />
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink href={`/admin/routes/${id}`}>{query.data.name}</BackLink>
      <PageHeader
        title="Edit route"
        description={
          query.data.trip_count > 0
            ? `${query.data.trip_count} trips use this route; timetable changes apply to them.`
            : "No trips use this route yet."
        }
      />
      <RouteForm
        route={query.data}
        submitLabel="Save route"
        onSubmit={async (payload) => {
          await update.mutateAsync(payload);
          router.push(`/admin/routes/${id}`);
        }}
        onCancel={() => router.push(`/admin/routes/${id}`)}
      />
    </div>
  );
}
