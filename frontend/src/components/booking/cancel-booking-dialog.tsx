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
import type { CustomerBooking } from "@/lib/api/booking-types";
import { bookingsApi } from "@/lib/api/endpoints";
import { getErrorMessage } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";
import { formatCurrency } from "@/lib/format";

/**
 * Cancelling a booking. Everything shown here — whether it is allowed, what comes back, and the
 * policy itself — is what the server answered; none of the rules live in the browser.
 */
export function CancelBookingDialog({
  booking,
  onClose,
}: {
  booking: CustomerBooking;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");

  const policy = useQuery({
    queryKey: queryKeys.cancellation(booking.id),
    queryFn: ({ signal }) => bookingsApi.cancellation(booking.id, signal),
  });
  const cancel = useMutation({
    mutationFn: () => bookingsApi.cancel(booking.id, reason.trim()),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.booking(booking.id), updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.allMyBookings });
      void queryClient.invalidateQueries({ queryKey: queryKeys.bookingSummary });
      const [refund] = updated.refunds;
      toast.success(
        refund
          ? `Booking cancelled. ${formatCurrency(refund.amount, refund.currency)} is on its way back to you.`
          : "Your booking was cancelled and the seats released.",
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
            Your seats go back on sale straight away, and a cancelled booking can’t be undone.
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
                  <dt className="text-muted-foreground">You paid</dt>
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

            {quote.rules && quote.rules.length > 0 && (
              <div className="text-xs text-muted-foreground">
                <p className="mb-1 font-medium text-foreground">Our cancellation policy</p>
                <ul className="list-disc space-y-1 pl-4">
                  {quote.rules.map((rule) => (
                    <li key={rule}>{rule}</li>
                  ))}
                </ul>
              </div>
            )}

            {quote.allowed && (
              <div className="grid gap-2">
                <Label htmlFor="cancel-reason">
                  Reason <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Textarea
                  id="cancel-reason"
                  rows={2}
                  maxLength={500}
                  value={reason}
                  placeholder="e.g. My plans changed"
                  onChange={(event) => setReason(event.target.value)}
                />
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
            disabled={!quote?.allowed || cancel.isPending}
          >
            {cancel.isPending && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
            {quote?.refundable ? `Cancel and refund ${money(quote.refund_amount)}` : "Cancel booking"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
