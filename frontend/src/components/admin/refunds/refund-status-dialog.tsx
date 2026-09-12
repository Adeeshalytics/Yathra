"use client";

import { InfoIcon, Loader2Icon } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAdminMutation } from "@/hooks/use-admin-mutation";
import { adminApi } from "@/lib/api/admin";
import type { AdminRefund, RefundStatus } from "@/lib/api/payment-types";
import { formatCurrency } from "@/lib/format";

/**
 * Move a refund request along. Completing it actually returns the money through the payment's
 * gateway — or records a refund the team made in the gateway's own portal.
 */
export function RefundStatusDialog({
  refund,
  onClose,
}: {
  refund: AdminRefund;
  onClose: () => void;
}) {
  const viaGateway = refund.payment?.refund_through_gateway ?? false;
  const [note, setNote] = useState("");
  const [external, setExternal] = useState(!viaGateway);

  const update = useAdminMutation({
    mutationFn: (status: RefundStatus) =>
      adminApi.refunds.setStatus(refund.id, { status, note: note.trim(), external }),
    successMessage: (updated) =>
      updated.status === "completed"
        ? `${updated.reference} was refunded.`
        : `${updated.reference} is now ${updated.status}.`,
    onSuccess: onClose,
  });

  const money = formatCurrency(refund.amount, refund.currency);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !update.isPending) onClose();
      }}
    >
      <DialogContent showCloseButton={!update.isPending} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Refund {refund.reference}</DialogTitle>
          <DialogDescription>
            {money} owed to {refund.customer.name} for booking {refund.booking_reference}.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {refund.reason && (
            <p className="rounded-lg bg-muted/60 p-3 text-sm">
              <span className="text-muted-foreground">Reason: </span>
              {refund.reason}
            </p>
          )}
          <div className="grid gap-2">
            <Label htmlFor="refund-note">
              Note <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="refund-note"
              rows={2}
              maxLength={255}
              value={note}
              placeholder="e.g. Sent back to the original card"
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          {viaGateway ? (
            <div className="flex items-start gap-2">
              <Checkbox
                id="refund-external"
                checked={external}
                onCheckedChange={(checked) => setExternal(checked === true)}
              />
              <Label htmlFor="refund-external" className="leading-snug font-normal">
                Already refunded in {refund.payment?.provider_name}’s portal — just record it
              </Label>
            </div>
          ) : (
            <Alert>
              <InfoIcon />
              <AlertDescription>
                {refund.payment
                  ? `${refund.payment.provider_name} refunds are made in its own portal (or in cash). Return the money there, then complete this request.`
                  : "There is no payment behind this request, so completing it only records the decision."}
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            onClick={() => update.mutate("rejected")}
            disabled={update.isPending}
          >
            Reject
          </Button>
          <div className="flex flex-col gap-2 sm:flex-row">
            {refund.status === "requested" && (
              <Button
                variant="outline"
                onClick={() => update.mutate("processing")}
                disabled={update.isPending}
              >
                Mark as processing
              </Button>
            )}
            <Button onClick={() => update.mutate("completed")} disabled={update.isPending}>
              {update.isPending && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
              Complete {money}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
