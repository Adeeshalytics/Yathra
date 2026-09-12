"use client";

import { useQuery } from "@tanstack/react-query";
import { LockIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { BackLink, DetailSkeleton, RecordError } from "@/components/admin/shared/page-parts";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { useAdminMutation } from "@/hooks/use-admin-mutation";
import { adminApi } from "@/lib/api/admin";
import type { TripPayload } from "@/lib/api/admin-types";
import { queryKeys } from "@/lib/api/query-keys";
import { formatTime, formatTripDate } from "@/lib/datetime";

import { TripForm } from "./trip-form";
import { TRIP_STATUS_LABEL } from "./trip-status";

export function TripCreateView() {
  const router = useRouter();
  const create = useAdminMutation({
    mutationFn: (payload: TripPayload) => adminApi.trips.create(payload),
    successMessage: (trip) => `${trip.code} is on the timetable.`,
    toastErrors: false,
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink href="/admin/trips">Trips</BackLink>
      <PageHeader
        title="New trip"
        description="Schedule a one-time departure. For regular services, use a recurring schedule."
      />
      <TripForm
        submitLabel="Create trip"
        onSubmit={async (payload) => {
          const trip = await create.mutateAsync(payload);
          router.push(`/admin/trips/${trip.id}`);
        }}
        onCancel={() => router.push("/admin/trips")}
      />
    </div>
  );
}

export function TripEditView({ id }: { id: string }) {
  const router = useRouter();
  const query = useQuery({
    queryKey: queryKeys.admin.detail("trips", id),
    queryFn: ({ signal }) => adminApi.trips.get(id, signal),
  });
  const update = useAdminMutation({
    mutationFn: (payload: TripPayload) => adminApi.trips.update(id, payload),
    successMessage: (trip) => `${trip.code} was updated.`,
    toastErrors: false,
  });

  if (query.isPending) return <DetailSkeleton />;
  if (query.isError) {
    return (
      <RecordError error={query.error} noun="trip" backHref="/admin/trips" onRetry={() => void query.refetch()} />
    );
  }

  const trip = query.data;
  if (trip.status !== "scheduled") {
    return (
      <EmptyState
        icon={LockIcon}
        title={`${trip.code} can’t be edited`}
        description={`It is ${TRIP_STATUS_LABEL[trip.status].toLowerCase()}. Only scheduled trips can change their route, bus, times or price.`}
        action={
          <Button asChild variant="outline">
            <Link href={`/admin/trips/${id}`}>Back to the trip</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink href={`/admin/trips/${id}`}>{trip.code}</BackLink>
      <PageHeader
        title="Edit trip"
        description={`${trip.route_summary.name} · ${formatTripDate(trip.departure_datetime)} at ${formatTime(trip.departure_datetime)}`}
      />
      <TripForm
        trip={trip}
        submitLabel="Save changes"
        onSubmit={async (payload) => {
          await update.mutateAsync(payload);
          router.push(`/admin/trips/${id}`);
        }}
        onCancel={() => router.push(`/admin/trips/${id}`)}
      />
    </div>
  );
}
