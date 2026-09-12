"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { BackLink, DetailSkeleton, RecordError } from "@/components/admin/shared/page-parts";
import { PageHeader } from "@/components/common/page-header";
import { useAdminMutation } from "@/hooks/use-admin-mutation";
import { adminApi } from "@/lib/api/admin";
import type { TripSchedulePayload } from "@/lib/api/admin-types";
import { queryKeys } from "@/lib/api/query-keys";

import { ScheduleForm } from "./schedule-form";
import { scheduleLabel } from "./schedules-list";

export function ScheduleCreateView() {
  const router = useRouter();
  const create = useAdminMutation({
    mutationFn: (payload: TripSchedulePayload) => adminApi.tripSchedules.create(payload),
    successMessage: (schedule) => `${scheduleLabel(schedule)} is set up. Generate its trips next.`,
    toastErrors: false,
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <BackLink href="/admin/schedules">Schedules</BackLink>
      <PageHeader
        title="New schedule"
        description="A departure that repeats every day or on selected weekdays."
      />
      <ScheduleForm
        submitLabel="Create schedule"
        onSubmit={async (payload) => {
          const schedule = await create.mutateAsync(payload);
          router.push(`/admin/schedules/${schedule.id}#generate`);
        }}
        onCancel={() => router.push("/admin/schedules")}
      />
    </div>
  );
}

export function ScheduleEditView({ id }: { id: string }) {
  const router = useRouter();
  const query = useQuery({
    queryKey: queryKeys.admin.detail("trip-schedules", id),
    queryFn: ({ signal }) => adminApi.tripSchedules.get(id, signal),
  });
  const update = useAdminMutation({
    mutationFn: (payload: TripSchedulePayload) => adminApi.tripSchedules.update(id, payload),
    successMessage: (schedule) => `${scheduleLabel(schedule)} was updated.`,
    toastErrors: false,
  });

  if (query.isPending) return <DetailSkeleton />;
  if (query.isError) {
    return (
      <RecordError
        error={query.error}
        noun="schedule"
        backHref="/admin/schedules"
        onRetry={() => void query.refetch()}
      />
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <BackLink href={`/admin/schedules/${id}`}>{scheduleLabel(query.data)}</BackLink>
      <PageHeader title="Edit schedule" description={query.data.bus_summary.registration_number} />
      <ScheduleForm
        schedule={query.data}
        submitLabel="Save changes"
        onSubmit={async (payload) => {
          await update.mutateAsync(payload);
          router.push(`/admin/schedules/${id}`);
        }}
        onCancel={() => router.push(`/admin/schedules/${id}`)}
      />
    </div>
  );
}
