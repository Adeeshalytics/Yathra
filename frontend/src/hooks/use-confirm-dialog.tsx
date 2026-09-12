"use client";

import { useState, type ReactNode } from "react";

import { ConfirmDialog } from "@/components/common/confirm-dialog";

export interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => Promise<unknown> | void;
}

/**
 * Imperative confirmation: `confirm({...})` opens the dialog; render `dialog` once.
 * Failures are expected to be reported by the action itself (e.g. a toast), so the dialog
 * simply closes.
 */
export function useConfirmDialog() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);

  const dialog = (
    <ConfirmDialog
      open={options !== null}
      onOpenChange={(open) => {
        if (!open) setOptions(null);
      }}
      title={options?.title ?? ""}
      description={options?.description}
      confirmLabel={options?.confirmLabel}
      destructive={options?.destructive}
      onConfirm={async () => {
        try {
          await options?.onConfirm();
        } catch {
          // Already surfaced to the user by the mutation's error toast.
        }
      }}
    />
  );

  return { confirm: setOptions, dialog };
}
