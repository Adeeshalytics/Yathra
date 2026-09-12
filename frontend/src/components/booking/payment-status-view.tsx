"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CircleCheckIcon,
  CircleXIcon,
  Loader2Icon,
  RefreshCwIcon,
  SearchXIcon,
  TimerOffIcon,
  TriangleAlertIcon,
  Undo2Icon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { CustomerBooking } from "@/lib/api/booking-types";
import { bookingsApi, paymentsApi } from "@/lib/api/endpoints";
import { ApiError, getErrorMessage } from "@/lib/api/errors";
import type { CustomerPayment } from "@/lib/api/payment-types";
import { queryKeys } from "@/lib/api/query-keys";
import { currentTime } from "@/lib/clock";
import { formatClock } from "@/lib/datetime";
import { formatCurrency } from "@/lib/format";
import { canRetryPayment, paymentPhase, type PaymentPhase } from "@/lib/payment";
import { cn } from "@/lib/utils";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POLL_INTERVAL_MS = 2000;
/** How long to wait before asking the server to check with the gateway itself. */
const AUTO_VERIFY_AFTER_MS = 10_000;
/** How long before we tell the customer it's taking longer than usual. */
const SLOW_AFTER_MS = 25_000;

const TONES = {
  success: "bg-emerald-50 text-emerald-700",
  danger: "bg-red-50 text-red-700",
  warning: "bg-amber-50 text-amber-800",
  info: "bg-primary/10 text-primary",
} as const;

function Outcome({
  tone,
  icon,
  title,
  children,
  actions,
}: {
  tone: keyof typeof TONES;
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <span className={cn("flex size-14 items-center justify-center rounded-full [&_svg]:size-7", TONES[tone])}>
        {icon}
      </span>
      <h1 className="text-2xl font-bold">{title}</h1>
      {children && <div className="max-w-md space-y-2 text-sm text-muted-foreground">{children}</div>}
      {actions && <div className="flex flex-col gap-2 sm:flex-row">{actions}</div>}
    </div>
  );
}

function PaymentFacts({ payment }: { payment: CustomerPayment }) {
  const facts = [
    { label: "Amount", value: formatCurrency(payment.amount, payment.currency) },
    { label: "Booking", value: payment.booking_reference },
    { label: "Payment reference", value: payment.transaction_reference },
    { label: "Paid with", value: payment.payment_method_label || payment.provider_name },
  ];
  return (
    <dl className="grid gap-3 border-t pt-5 text-sm sm:grid-cols-2">
      {facts.map((fact) => (
        <div key={fact.label} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{fact.label}</dt>
          <dd className="truncate font-medium">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function PaymentNotFound({ bookingId }: { bookingId: string }) {
  return (
    <EmptyState
      icon={SearchXIcon}
      title="We couldn’t find this payment"
      description="Open your booking to see where things stand."
      action={
        <Button asChild variant="outline">
          <Link href={`/bookings/${bookingId}`}>Your booking</Link>
        </Button>
      }
    />
  );
}

function RetryActions({ bookingId, booking }: { bookingId: string; booking?: CustomerBooking }) {
  if (booking && canRetryPayment(booking)) {
    return (
      <>
        <Button asChild variant="cta" size="lg">
          <Link href={`/bookings/${bookingId}/checkout`}>Try again</Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href={`/bookings/${bookingId}`}>Booking details</Link>
        </Button>
      </>
    );
  }
  return (
    <Button asChild variant="cta" size="lg">
      <Link href={booking ? `/trips/${booking.trip.id}` : "/#search"}>Choose seats again</Link>
    </Button>
  );
}

/**
 * Where the gateway sends the customer back to. It never takes the browser's word for the
 * outcome: it shows what our server has verified with the gateway, polling until it's settled.
 */
export function PaymentStatusView({
  bookingId,
  paymentId,
  cancelled = false,
}: {
  bookingId: string;
  paymentId: string | null;
  /** The customer came back through the gateway's cancel link. */
  cancelled?: boolean;
}) {
  const queryClient = useQueryClient();
  const id = paymentId && UUID_PATTERN.test(paymentId) ? paymentId : null;

  const paymentQuery = useQuery({
    queryKey: queryKeys.payment(id ?? "none"),
    queryFn: ({ signal }) => paymentsApi.get(id ?? "", signal),
    enabled: id !== null,
    refetchInterval: (query) =>
      query.state.data && paymentPhase(query.state.data) === "verifying" ? POLL_INTERVAL_MS : false,
  });
  const bookingQuery = useQuery({
    queryKey: queryKeys.booking(bookingId),
    queryFn: ({ signal }) => bookingsApi.get(bookingId, signal),
    enabled: id !== null,
  });
  const payment = paymentQuery.data;
  const phase: PaymentPhase | null = payment ? paymentPhase(payment) : null;

  const store = (data: CustomerPayment) => {
    queryClient.setQueryData(queryKeys.payment(data.id), data);
    void queryClient.invalidateQueries({ queryKey: queryKeys.booking(bookingId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.allMyBookings });
  };
  const verify = useMutation({
    mutationFn: () => paymentsApi.verify(id ?? ""),
    onSuccess: store,
    onError: (error) => toast.error(getErrorMessage(error)),
  });
  const cancelAttempt = useMutation({ mutationFn: () => paymentsApi.cancel(id ?? ""), onSuccess: store });
  const verifyNow = verify.mutate;
  const cancelNow = cancelAttempt.mutate;

  const cancelSent = useRef(false);
  useEffect(() => {
    if (!cancelled || !id || cancelSent.current) return;
    cancelSent.current = true;
    cancelNow();
  }, [cancelled, id, cancelNow]);

  // How long we've been waiting, ticked by a timer (never read the clock while rendering).
  const [startedAt] = useState(currentTime);
  const [now, setNow] = useState(currentTime);
  useEffect(() => {
    if (phase !== "verifying") return;
    const timer = window.setInterval(() => setNow(currentTime()), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);
  const waited = Math.max(0, now - startedAt);

  const autoVerified = useRef(false);
  const dueForCheck = phase === "verifying" && waited >= AUTO_VERIFY_AFTER_MS;
  useEffect(() => {
    if (!dueForCheck || autoVerified.current) return;
    autoVerified.current = true;
    verifyNow();
  }, [dueForCheck, verifyNow]);

  const settled = phase !== null && phase !== "verifying";
  useEffect(() => {
    if (settled) void queryClient.invalidateQueries({ queryKey: queryKeys.booking(bookingId) });
  }, [settled, bookingId, queryClient]);

  if (!id) return <PaymentNotFound bookingId={bookingId} />;
  if (paymentQuery.isError) {
    return paymentQuery.error instanceof ApiError && paymentQuery.error.status === 404 ? (
      <PaymentNotFound bookingId={bookingId} />
    ) : (
      <ErrorState error={paymentQuery.error} onRetry={() => void paymentQuery.refetch()} />
    );
  }

  const booking = bookingQuery.data;
  const heldUntil = booking?.expires_at && canRetryPayment(booking) ? formatClock(booking.expires_at) : null;
  const gateway = payment?.provider_name ?? "the payment gateway";
  let outcome: ReactNode;

  if (!payment || !phase || (cancelled && cancelAttempt.isPending)) {
    outcome = <Outcome tone="info" icon={<Loader2Icon className="animate-spin" />} title="Checking your payment…" />;
  } else if (phase === "paid") {
    outcome = (
      <Outcome
        tone="success"
        icon={<CircleCheckIcon />}
        title="Payment successful"
        actions={
          <>
            <Button asChild variant="cta" size="lg">
              <Link href={`/bookings/${bookingId}/ticket`}>View e-ticket</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href={`/bookings/${bookingId}`}>Booking details</Link>
            </Button>
          </>
        }
      >
        <p>
          Booking <span className="font-mono font-semibold text-foreground">{payment.booking_reference}</span> is
          confirmed and your e-ticket is ready.
        </p>
      </Outcome>
    );
  } else if (phase === "failed" || phase === "cancelled") {
    outcome = (
      <Outcome
        tone="danger"
        icon={<CircleXIcon />}
        title={phase === "failed" ? "Payment didn’t go through" : "Payment cancelled"}
        actions={<RetryActions bookingId={bookingId} booking={booking} />}
      >
        <p>
          {phase === "failed"
            ? payment.failure_reason || "The payment was declined."
            : "You cancelled the payment. No money was taken."}
        </p>
        {heldUntil && <p>Your seats are still held until {heldUntil}, so you can try again.</p>}
      </Outcome>
    );
  } else if (phase === "refund_due") {
    outcome = (
      <Outcome
        tone="warning"
        icon={<TriangleAlertIcon />}
        title="We received your payment, but couldn’t keep your seats"
        actions={
          <Button asChild variant="outline" size="lg">
            <Link href="/account">My bookings</Link>
          </Button>
        }
      >
        {payment.failure_reason && <p>{payment.failure_reason}</p>}
        <p>
          We’ll refund {formatCurrency(payment.amount, payment.currency)} to you in full — you don’t need to
          do anything.
        </p>
      </Outcome>
    );
  } else if (phase === "refunded") {
    outcome = (
      <Outcome tone="info" icon={<Undo2Icon />} title="This payment was refunded">
        <p>{formatCurrency(payment.refunded_amount, payment.currency)} was returned to you.</p>
      </Outcome>
    );
  } else if (phase === "expired") {
    outcome = (
      <Outcome
        tone="warning"
        icon={<TimerOffIcon />}
        title="Your seat hold ended"
        actions={<RetryActions bookingId={bookingId} booking={booking} />}
      >
        <p>
          We hadn’t heard from {gateway} before your seats were released. If money left your account,
          we’ll confirm your booking or refund you automatically as soon as {gateway} tells us.
        </p>
      </Outcome>
    );
  } else {
    const slow = waited >= SLOW_AFTER_MS;
    outcome = (
      <Outcome
        tone="info"
        icon={<Loader2Icon className="animate-spin" />}
        title="Confirming your payment…"
        actions={
          slow && (
            <Button variant="outline" size="lg" onClick={() => verifyNow()} disabled={verify.isPending}>
              <RefreshCwIcon className={cn(verify.isPending && "animate-spin")} data-icon="inline-start" />
              Check again
            </Button>
          )
        }
      >
        <p role="status">
          We’re waiting for {gateway} to confirm your payment. This usually takes a few seconds — please
          don’t pay again.
        </p>
        {slow && (
          <p>
            This is taking longer than usual. If money has left your account, your booking will be
            confirmed as soon as {gateway} tells us.
          </p>
        )}
      </Outcome>
    );
  }

  return (
    <Card className="mx-auto w-full max-w-xl">
      <CardContent className="space-y-6 py-10">
        {outcome}
        {payment && <PaymentFacts payment={payment} />}
      </CardContent>
    </Card>
  );
}
