"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightIcon,
  BanIcon,
  CircleCheckIcon,
  Loader2Icon,
  LockIcon,
  SearchXIcon,
  ShieldCheckIcon,
  TimerOffIcon,
  TriangleAlertIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { BackLink } from "@/components/admin/shared/page-parts";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { BookingStop, CustomerBooking } from "@/lib/api/booking-types";
import { bookingsApi, paymentsApi } from "@/lib/api/endpoints";
import { ApiError, getErrorMessage } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";
import { isUnpaid } from "@/lib/booking";
import { formatClock, formatTripDate } from "@/lib/datetime";
import { formatCurrency, pluralize } from "@/lib/format";
import { goToCheckout } from "@/lib/payment";
import { cn } from "@/lib/utils";

import { HoldTimer, useCountdown } from "./hold-countdown";

function Line({ label, note, value }: { label: string; note?: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">
        {label}
        {note && <span className="block text-xs">{note}</span>}
      </dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

/** Ticket price, fees and total — all calculated by the server when the booking was made. */
function CheckoutTotals({ booking }: { booking: CustomerBooking }) {
  const { price } = booking;
  const money = (value: string | number) => formatCurrency(value, price.currency);
  const fees = Number(price.service_fee) + Number(price.tax);
  return (
    <dl className="space-y-2 text-sm">
      <Line
        label="Ticket price"
        note={`${money(price.unit_price)} × ${pluralize(price.seats, "seat")}`}
        value={money(price.subtotal)}
      />
      <Line label="Fees" note={Number(price.tax) > 0 ? "Service fee and taxes" : undefined} value={money(fees)} />
      {Number(price.discount) > 0 && <Line label="Discount" value={`− ${money(price.discount)}`} />}
      <div className="flex justify-between gap-3 border-t pt-2 font-heading text-lg font-bold">
        <dt>Total</dt>
        <dd className="tabular-nums">{money(price.total)}</dd>
      </div>
    </dl>
  );
}

function Stop({ label, point }: { label: string; point: BookingStop | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-semibold">{point?.stop.name ?? "—"}</dd>
      {point?.time && (
        <dd className="text-sm text-muted-foreground">
          {formatTripDate(point.time)} · {formatClock(point.time)}
        </dd>
      )}
    </div>
  );
}

/** Shown instead of the checkout when there's nothing (left) to pay. */
function NothingToPay({ booking, ranOut }: { booking: CustomerBooking; ranOut: boolean }) {
  let content: { icon: typeof CircleCheckIcon; title: string; description: string; action: ReactNode };
  if (booking.status === "confirmed" || booking.status === "completed") {
    content = {
      icon: CircleCheckIcon,
      title: "This booking is already paid",
      description: `Booking ${booking.booking_reference} is confirmed.`,
      action: (
        <Button asChild variant="cta">
          <Link href={`/bookings/${booking.id}/ticket`}>View e-ticket</Link>
        </Button>
      ),
    };
  } else if (booking.status === "cancelled") {
    content = {
      icon: BanIcon,
      title: "This booking was cancelled",
      description: "Its seats were released. You can book the trip again.",
      action: (
        <Button asChild variant="cta">
          <Link href={`/trips/${booking.trip.id}`}>Book this trip</Link>
        </Button>
      ),
    };
  } else {
    content = {
      icon: TimerOffIcon,
      title: ranOut ? "Your seat hold ran out" : "This booking has expired",
      description: "The seats were released for other passengers before payment.",
      action: (
        <Button asChild variant="cta">
          <Link href={`/trips/${booking.trip.id}`}>Choose seats again</Link>
        </Button>
      ),
    };
  }
  return <EmptyState {...content} />;
}

/**
 * The checkout: what you're buying and what it costs, a choice of gateway and Pay Now. Paying
 * happens on the gateway's own page; the booking is confirmed when the gateway tells our server.
 */
export function CheckoutView({ id }: { id: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [chosen, setChosen] = useState<string | null>(null);

  const bookingQuery = useQuery({
    queryKey: queryKeys.booking(id),
    queryFn: ({ signal }) => bookingsApi.get(id, signal),
  });
  const providersQuery = useQuery({
    queryKey: queryKeys.paymentProviders,
    queryFn: ({ signal }) => paymentsApi.providers(signal),
    staleTime: 5 * 60_000,
  });
  const booking = bookingQuery.data;
  const providers = providersQuery.data?.providers ?? [];
  const providerCode = chosen ?? providersQuery.data?.default ?? providers[0]?.code ?? "";
  const provider = providers.find((option) => option.code === providerCode);

  const remaining = useCountdown(
    booking && isUnpaid(booking.status) ? booking.seconds_remaining : null,
    bookingQuery.dataUpdatedAt,
  );
  const ranOut = remaining === 0;

  const pay = useMutation({
    mutationFn: () => paymentsApi.start(id, providerCode),
    onSuccess: ({ checkout }) => {
      if (checkout.method === "none") {
        void queryClient.invalidateQueries({ queryKey: queryKeys.booking(id) });
        router.push(`/bookings/${id}/ticket`);
        return;
      }
      goToCheckout(checkout);
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
      void bookingQuery.refetch();
    },
  });
  const resetPay = pay.reset;

  useEffect(() => {
    if (ranOut) void queryClient.invalidateQueries({ queryKey: queryKeys.booking(id) });
  }, [ranOut, id, queryClient]);

  // Coming back from the gateway with the browser's Back button restores this page as it was.
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) resetPay();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, [resetPay]);

  if (bookingQuery.isPending) {
    return (
      <div className="space-y-6" aria-busy>
        <Skeleton className="h-9 w-56" />
        <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
          <Skeleton className="h-96 rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      </div>
    );
  }
  if (bookingQuery.isError) {
    return bookingQuery.error instanceof ApiError && bookingQuery.error.status === 404 ? (
      <EmptyState
        icon={SearchXIcon}
        title="Booking not found"
        description="It may belong to another account, or the link is wrong."
        action={
          <Button asChild variant="outline">
            <Link href="/account">My bookings</Link>
          </Button>
        }
      />
    ) : (
      <ErrorState error={bookingQuery.error} onRetry={() => void bookingQuery.refetch()} />
    );
  }

  const data = bookingQuery.data;
  if (!isUnpaid(data.status) || ranOut) return <NothingToPay booking={data} ranOut={ranOut} />;

  const redirecting = pay.isPending || pay.isSuccess;
  const lastAttempt = data.payment;
  const gatewayName = provider?.name ?? "the payment gateway";

  return (
    <div className="space-y-6">
      <BackLink href={`/bookings/${id}`}>Back to booking review</BackLink>
      <header className="space-y-2">
        <h1 className="text-2xl font-bold sm:text-3xl">Payment</h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          Booking <span className="font-mono font-semibold text-foreground">{data.booking_reference}</span>
          {remaining !== null && (
            <>
              · seats held for
              <HoldTimer remainingMs={remaining} />
            </>
          )}
        </p>
      </header>

      {lastAttempt && (lastAttempt.status === "failed" || lastAttempt.status === "cancelled") && (
        <Alert className="border-amber-200 bg-amber-50 text-amber-900">
          <TriangleAlertIcon />
          <AlertDescription className="text-inherit">
            {lastAttempt.status === "failed"
              ? `Your last payment didn’t go through${lastAttempt.failure_reason ? `: ${lastAttempt.failure_reason}` : "."} `
              : "You cancelled your last payment — no money was taken. "}
            You can try again below.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>
                {data.trip.route.origin.city} → {data.trip.route.destination.city}
              </CardTitle>
              <CardDescription>
                {data.trip.operator.name} · {data.trip.bus.name} ({data.trip.bus.bus_type_label}) · Trip{" "}
                {data.trip.code}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 rounded-xl bg-muted/60 p-4 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                <Stop label="Boarding point" point={data.boarding} />
                <ArrowRightIcon className="hidden size-4 text-muted-foreground sm:block" aria-hidden />
                <Stop label="Drop-off point" point={data.dropoff} />
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Passengers</CardTitle>
              <CardDescription>
                {data.seats.length === 1 ? "Seat" : "Seats"} {data.seats.join(", ")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y rounded-xl border">
                {data.passengers.map((passenger) => (
                  <li key={passenger.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                    <span className="min-w-0 truncate font-medium">{passenger.name}</span>
                    <span className="rounded-md bg-primary/10 px-2 py-1 text-xs font-semibold text-primary tabular-nums">
                      Seat {passenger.seat_number}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>

        <aside className="lg:sticky lg:top-24">
          <Card>
            <CardHeader>
              <CardTitle>Pay for your booking</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <CheckoutTotals booking={data} />

              {providersQuery.isError ? (
                <ErrorState error={providersQuery.error} onRetry={() => void providersQuery.refetch()} />
              ) : providersQuery.isPending ? (
                <Skeleton className="h-24 rounded-xl" />
              ) : providers.length === 0 ? (
                <Alert>
                  <TriangleAlertIcon />
                  <AlertDescription>Online payment isn’t available right now. Please try again later.</AlertDescription>
                </Alert>
              ) : (
                <fieldset className="space-y-2" disabled={redirecting}>
                  <legend className="mb-2 text-sm font-medium">Pay with</legend>
                  {providers.map((option) => (
                    <label
                      key={option.code}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors",
                        "has-checked:border-primary has-checked:bg-primary/5 has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                      )}
                    >
                      <input
                        type="radio"
                        name="provider"
                        value={option.code}
                        checked={providerCode === option.code}
                        onChange={() => setChosen(option.code)}
                        className="mt-1 accent-primary"
                      />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2 font-medium">
                          {option.name}
                          {option.test_mode && (
                            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-900">
                              Test mode
                            </Badge>
                          )}
                        </span>
                        <span className="block text-xs text-muted-foreground">{option.description}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}

              <Button
                variant="cta"
                size="xl"
                className="w-full"
                disabled={!provider || redirecting}
                onClick={() => pay.mutate()}
              >
                {redirecting ? (
                  <Loader2Icon className="animate-spin" data-icon="inline-start" />
                ) : (
                  <LockIcon data-icon="inline-start" />
                )}
                {redirecting ? `Taking you to ${gatewayName}…` : `Pay Now · ${formatCurrency(data.total_amount, data.currency)}`}
              </Button>
              <p className="flex gap-2 text-xs text-muted-foreground">
                <ShieldCheckIcon className="size-4 shrink-0 text-primary" aria-hidden />
                You’ll enter your card or wallet details on {gatewayName}’s secure page — we never see or
                store them. Your booking is confirmed as soon as {gatewayName} confirms the payment to us.
              </p>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
