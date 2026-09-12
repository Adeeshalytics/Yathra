"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { BackLink, DetailSkeleton, RecordError } from "@/components/admin/shared/page-parts";
import { PageHeader } from "@/components/common/page-header";
import { useAdminMutation } from "@/hooks/use-admin-mutation";
import { adminApi } from "@/lib/api/admin";
import type { OperatorPayload } from "@/lib/api/admin-types";
import { queryKeys } from "@/lib/api/query-keys";

import { OperatorForm } from "./operator-form";

export function OperatorCreateView() {
  const router = useRouter();
  const create = useAdminMutation({
    mutationFn: (payload: OperatorPayload) => adminApi.operators.create(payload),
    successMessage: (operator) => `${operator.company_name} was added.`,
    toastErrors: false,
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <BackLink href="/admin/operators">Operators</BackLink>
      <PageHeader
        title="Add operator"
        description="Register a bus company. New operators start as pending until you approve them."
      />
      <OperatorForm
        submitLabel="Create operator"
        onSubmit={async (payload) => {
          const operator = await create.mutateAsync(payload);
          router.push(`/admin/operators/${operator.id}`);
        }}
        onCancel={() => router.push("/admin/operators")}
      />
    </div>
  );
}

export function OperatorEditView({ id }: { id: string }) {
  const router = useRouter();
  const query = useQuery({
    queryKey: queryKeys.admin.detail("operators", id),
    queryFn: ({ signal }) => adminApi.operators.get(id, signal),
  });
  const update = useAdminMutation({
    mutationFn: (payload: OperatorPayload) => adminApi.operators.update(id, payload),
    successMessage: (operator) => `${operator.company_name} was updated.`,
    toastErrors: false,
  });

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

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <BackLink href={`/admin/operators/${id}`}>{query.data.company_name}</BackLink>
      <PageHeader title="Edit operator" description={query.data.registration_number} />
      <OperatorForm
        operator={query.data}
        submitLabel="Save changes"
        onSubmit={async (payload) => {
          await update.mutateAsync(payload);
          router.push(`/admin/operators/${id}`);
        }}
        onCancel={() => router.push(`/admin/operators/${id}`)}
      />
    </div>
  );
}
