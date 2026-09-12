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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAdminMutation } from "@/hooks/use-admin-mutation";
import { adminApi } from "@/lib/api/admin";
import type { AdminPaymentDetail } from "@/lib/api/payment-types";
import { formatCurrency } from "@/lib/format";

/**
 * Refund all or part of a payment. Through the gateway's API when it has one; otherwise the
 * admin refunds in the gateway's portal (or hands back cash) and records it here.
 */
export function RefundDialog({ payment, onClose }: { payment: AdminPaymentDetail; onClose: () => void }) {
  const remaining = Number(payment.refundable_amount);
  // Flagged for refund without being a successful payment (e.g. the gateway reported a wrong
  // amount): only a refund made in the gateway's portal can settle it.
  const recordOnly = remaining === 0;
  const viaGateway = payment.refund_through_gateway && payment.provider !== "manual" && !recordOnly;
  const [amount, setAmount] = useState(payment.refundable_amount);
  const [reason, setReason] = useState("");
  const [external, setExternal] = useState(false);

  const value = Number(amount);
  const amountError =
    recordOnly || (Number.isFinite(value) && value > 0 && value <= remaining)
      ? null
      : `Enter an amount between ${formatCurrency(0.01, payment.currency)} and ${formatCurrency(remaining, payment.currency)}.`;
  const full = recordOnly || value === remaining;

  const refund = useAdminMutation({
    mutationFn: () =>
      adminApi.payments.refund(payment.id, {
        amount: recordOnly ? null : amount,
        reason: reason.trim(),
        external: !viaGateway || external,
      }),
    successMessage: (data) =>
      data.status === "refunded"
        ? `${data.transaction_reference} was refunded in full.`
        : `Refund recorded for ${data.transaction_reference}.`,
    onSuccess: onClose,
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !refund.isPending) onClose();
      }}
    >
      <DialogContent showCloseButton={!refund.isPending} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Refund {payment.transaction_reference}</DialogTitle>
          <DialogDescription>
            {full && payment.booking_detail.status === "confirmed"
              ? `A full refund cancels booking ${payment.booking_detail.booking_reference} and releases its seats.`
              : "The booking itself doesn’t change."}
          </DialogDescription>
        </DialogHeader>

        <form
          id="refund-form"
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!amountError) refund.mutate();
          }}
        >
          {!recordOnly && (
            <div className="grid gap-2">
              <Label htmlFor="refund-amount">Amount ({payment.currency})</Label>
              <Input
                id="refund-amount"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                max={payment.refundable_amount}
                value={amount}
                aria-invalid={amountError !== null}
                aria-describedby="refund-amount-hint"
                onChange={(event) => setAmount(event.target.value)}
              />
              <p id="refund-amount-hint" className={amountError ? "text-sm text-destructive" : "text-xs text-muted-foreground"}>
                {amountError ?? `Up to ${formatCurrency(remaining, payment.currency)} can be refunded.`}
              </p>
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="refund-reason">
              Reason <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="refund-reason"
              rows={2}
              maxLength={200}
              value={reason}
              placeholder="e.g. Customer couldn’t travel"
              onChange={(event) => setReason(event.target.value)}
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
                Already refunded in {payment.provider_name}’s portal — just record it
              </Label>
            </div>
          ) : (
            <Alert>
              <InfoIcon />
              <AlertDescription>
                {payment.provider === "manual"
                  ? "This was paid at the counter: hand the money back, then record the refund here."
                  : `${payment.provider_name} refunds are made in its merchant portal. Refund the payment there first, then record it here.`}
              </AlertDescription>
            </Alert>
          )}
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={refund.isPending}>
            Keep payment
          </Button>
          <Button type="submit" form="refund-form" variant="destructive" disabled={refund.isPending || amountError !== null}>
            {refund.isPending && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
            {recordOnly ? "Record refund" : `Refund ${formatCurrency(value || 0, payment.currency)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
