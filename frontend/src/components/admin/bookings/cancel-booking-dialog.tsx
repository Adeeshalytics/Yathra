"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { InfoIcon, Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { adminApi } from "@/lib/api/admin";
import type { CustomerBooking } from "@/lib/api/booking-types";
import { getErrorMessage } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";
import { formatCurrency } from "@/lib/format";

/**
 * Cancelling a booking from the office. The quote — what may be cancelled and what comes back —
 * is the server's, taken with staff powers, so support sees the same policy the customer does
 * plus whatever it lets the office override.
 */
export function AdminCancelBookingDialog({
  booking,
  onClose,
}: {
  booking: CustomerBooking;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");

  const policy = useQuery({
    queryKey: queryKeys.admin.bookingCancellation(booking.id),
    queryFn: ({ signal }) => adminApi.bookings.cancellation(booking.id, signal),
  });
  const cancel = useMutation({
    mutationFn: () => adminApi.bookings.cancel(booking.id, reason.trim()),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.admin.detail("bookings", booking.id), updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.all });
      const [refund] = updated.refunds;
      toast.success(
        refund
          ? `${updated.booking_reference} cancelled. ${formatCurrency(refund.amount, refund.currency)} is queued for refund.`
          : `${updated.booking_reference} was cancelled and the seats released.`,
      );
      onClose();
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
      void policy.refetch();
    },
  });

  const quote = policy.data;
  const money = (value: string) => formatCurrency(value, quote?.currency ?? booking.currency);

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !cancel.isPending) onClose();
      }}
    >
      <DialogContent showCloseButton={!cancel.isPending} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel {booking.booking_reference}?</DialogTitle>
          <DialogDescription>
            The seats go back on sale immediately and a refund is raised where the policy allows
            one. This can’t be undone.
          </DialogDescription>
        </DialogHeader>

        {policy.isPending ? (
          <Skeleton className="h-32 rounded-xl" />
        ) : policy.isError ? (
          <Alert variant="destructive" className="bg-destructive/5">
            <TriangleAlertIcon />
            <AlertDescription>{getErrorMessage(policy.error)}</AlertDescription>
          </Alert>
        ) : quote ? (
          <div className="space-y-4">
            {!quote.allowed && (
              <Alert variant="destructive" className="bg-destructive/5">
                <TriangleAlertIcon />
                <AlertDescription>{quote.message}</AlertDescription>
              </Alert>
            )}

            {quote.allowed && Number(quote.paid_amount) > 0 && (
              <dl className="space-y-1.5 rounded-xl bg-muted/60 p-4 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Customer paid</dt>
                  <dd className="tabular-nums">{money(quote.paid_amount)}</dd>
                </div>
                {Number(quote.fee) > 0 && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Cancellation fee</dt>
                    <dd className="tabular-nums">− {money(quote.fee)}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-3 border-t pt-2 font-semibold">
                  <dt>Refund ({quote.refund_percent}%)</dt>
                  <dd className="tabular-nums">{money(quote.refund_amount)}</dd>
                </div>
              </dl>
            )}

            {quote.allowed && (
              <Alert>
                <InfoIcon />
                <AlertDescription>{quote.message}</AlertDescription>
              </Alert>
            )}

            {quote.allowed && (
              <div className="grid gap-2">
                <Label htmlFor="admin-cancel-reason">
                  Reason <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Textarea
                  id="admin-cancel-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Why is the office cancelling this booking?"
                  maxLength={500}
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">
                  Kept on the booking and in the activity log.
                </p>
              </div>
            )}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={cancel.isPending}>
            Keep booking
          </Button>
          <Button
            variant="destructive"
            onClick={() => cancel.mutate()}
            disabled={cancel.isPending || !quote?.allowed}
          >
            {cancel.isPending && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
            Cancel booking
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
