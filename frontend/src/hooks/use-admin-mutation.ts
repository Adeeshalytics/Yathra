"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { AdminResource } from "@/lib/api/admin";
import { getErrorMessage } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";

interface AdminMutationOptions<TData, TVariables> {
  mutationFn: (variables: TVariables) => Promise<TData>;
  successMessage?: (data: TData, variables: TVariables) => string;
  /** Show the API's error message as a toast (forms turn this off and show it inline). */
  toastErrors?: boolean;
  onSuccess?: (data: TData, variables: TVariables) => void;
}

/**
 * Mutation for admin data: toasts on success/failure and refreshes every admin query,
 * because counts cross resources (a new bus changes operator and layout counts too).
 */
export function useAdminMutation<TData, TVariables>({
  mutationFn,
  successMessage,
  toastErrors = true,
  onSuccess,
}: AdminMutationOptions<TData, TVariables>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async (data, variables) => {
      if (successMessage) toast.success(successMessage(data, variables));
      onSuccess?.(data, variables);
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.all });
    },
    onError: (error) => {
      if (toastErrors) toast.error(getErrorMessage(error));
    },
  });
}

interface RecordEndpoints {
  activate: (id: string) => Promise<unknown>;
  deactivate: (id: string) => Promise<unknown>;
  remove: (id: string) => Promise<unknown>;
}

export interface RecordRef {
  id: string;
  label: string;
}

/** Activate / deactivate / delete for one resource, with toasts. */
export function useRecordMutations(resource: AdminResource, endpoints: RecordEndpoints) {
  const queryClient = useQueryClient();
  return {
    activate: useAdminMutation({
      mutationFn: (record: RecordRef) => endpoints.activate(record.id),
      successMessage: (_, record) => `${record.label} is now active.`,
    }),
    deactivate: useAdminMutation({
      mutationFn: (record: RecordRef) => endpoints.deactivate(record.id),
      successMessage: (_, record) => `${record.label} has been deactivated.`,
    }),
    remove: useAdminMutation({
      mutationFn: (record: RecordRef) => endpoints.remove(record.id),
      successMessage: (_, record) => `${record.label} was deleted.`,
      // Drop the deleted record's cache so an open detail page doesn't refetch a 404.
      onSuccess: (_, record) =>
        queryClient.removeQueries({ queryKey: queryKeys.admin.detail(resource, record.id) }),
    }),
  };
}
