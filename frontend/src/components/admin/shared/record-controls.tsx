"use client";

import { EllipsisIcon } from "lucide-react";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useRecordMutations, type RecordRef } from "@/hooks/use-admin-mutation";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import type { AdminResource } from "@/lib/api/admin";

export interface RowAction {
  label: string;
  icon?: ReactNode;
  href?: string;
  onSelect?: () => void;
  destructive?: boolean;
  separatorBefore?: boolean;
}

/** "…" menu with the actions for one table row. */
export function RowActions({ label, actions }: { label: string; actions: RowAction[] }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-lg" aria-label={`Actions for ${label}`}>
          <EllipsisIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {actions.map((action) => (
          <Fragment key={action.label}>
            {action.separatorBefore && <DropdownMenuSeparator />}
            {action.href ? (
              <DropdownMenuItem asChild>
                <Link href={action.href}>
                  {action.icon}
                  {action.label}
                </Link>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                variant={action.destructive ? "destructive" : "default"}
                onSelect={action.onSelect}
              >
                {action.icon}
                {action.label}
              </DropdownMenuItem>
            )}
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface RecordEndpoints {
  activate: (id: string) => Promise<unknown>;
  deactivate: (id: string) => Promise<unknown>;
  remove: (id: string) => Promise<unknown>;
}

/**
 * Activate / deactivate / delete with confirmation dialogs and toasts, for list rows and
 * detail pages alike. Render `dialog` once in the component.
 */
export function useRecordControls(resource: AdminResource, endpoints: RecordEndpoints, noun: string) {
  const mutations = useRecordMutations(resource, endpoints);
  const { confirm, dialog } = useConfirmDialog();

  return {
    dialog,
    mutations,
    isBusy:
      mutations.activate.isPending || mutations.deactivate.isPending || mutations.remove.isPending,
    activate: (record: RecordRef) => mutations.activate.mutate(record),
    requestDeactivate: (record: RecordRef, description?: ReactNode) =>
      confirm({
        title: `Deactivate ${record.label}?`,
        description:
          description ??
          `The ${noun} stays on record but can’t be used until you activate it again.`,
        confirmLabel: "Deactivate",
        destructive: true,
        onConfirm: () => mutations.deactivate.mutateAsync(record),
      }),
    requestDelete: (record: RecordRef, options: { description?: ReactNode; onDeleted?: () => void } = {}) =>
      confirm({
        title: `Delete ${record.label}?`,
        description:
          options.description ??
          `This permanently removes the ${noun}. Anything still in use can’t be deleted — deactivate it instead.`,
        confirmLabel: "Delete",
        destructive: true,
        onConfirm: async () => {
          await mutations.remove.mutateAsync(record);
          options.onDeleted?.();
        },
      }),
  };
}
