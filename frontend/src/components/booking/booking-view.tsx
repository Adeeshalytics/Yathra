"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightIcon,
  BanIcon,
  CircleCheckIcon,
  CreditCardIcon,
  DownloadIcon,
  Loader2Icon,
  PencilIcon,
  SearchXIcon,
  TicketIcon,
  TimerIcon,
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
import { StatusBadge } from "@/components/common/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { formatCurrency } from "@/lib/format";
import { saveBlob } from "@/lib/payment";
import { siteConfig } from "@/lib/site";
import type { CustomerBooking, PassengerInput } from "@/lib/api/booking-types";
import { bookingsApi } from "@/lib/api/endpoints";
import { ApiError, getErrorMessage } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";
import { isUnpaid } from "@/lib/booking";
import { formatClock, formatJourney, formatTripDate, minutesBetween } from "@/lib/datetime";
import { formatDateTime } from "@/lib/format";
import { passengerDefaults } from "@/lib/validations/booking";

import { CancelBookingDialog } from "./cancel-booking-dialog";
import { HoldTimer, useCountdown } from "./hold-countdown";
import { PassengerDetailsForm } from "./passenger-details-form";
import { PriceBreakdown } from "./price-breakdown";

function StatusPanel({ booking, remaining }: { booking: CustomerBooking; remaining: number | null }) {
  const heldUntil = booking.expires_at ? formatClock(booking.expires_at) : null;
  const timer = remaining !== null && <HoldTimer remainingMs={remaining} className="mx-1" />;
  const panels: Record<CustomerBooking["status"], { icon: ReactNode; tone?: string; text: ReactNode }> = {
    pending: {
      icon: <TimerIcon />,
      text: (
        <>
          Check everything below, then continue to payment. Your seats are held
          {heldUntil && ` until ${heldUntil}`}
          {timer}.
        </>
      ),
    },
    payment_pending: {
      icon: <CreditCardIcon />,
      text: (
        <>
          Waiting for payment. Your seats stay held
          {heldUntil && ` until ${heldUntil}`}
          {timer}.
        </>
      ),
    },
    confirmed: {
      icon: <CircleCheckIcon />,
      tone: "border-emerald-200 bg-emerald-50 text-emerald-900",
      text: <>Your booking is confirmed and your e-ticket is ready. Show its QR code when you board.</>,
    },
    expired: {
      icon: <TimerOffIcon />,
      tone: "border-amber-200 bg-amber-50 text-amber-900",
      text: <>Your seat hold ran out before payment, so the seats were released for other passengers.</>,
    },
    cancelled: {
      icon: <BanIcon />,
      tone: "border-red-200 bg-red-50 text-red-800",
      text: (
        <>
          This booking was cancelled{booking.cancelled_at && ` on ${formatDateTime(booking.cancelled_at)}`}.
          {booking.cancellation_reason && ` ${booking.cancellation_reason}`}
        </>
      ),
    },
    completed: {
      icon: <CircleCheckIcon />,
      text: <>This trip is complete. Thanks for travelling with us!</>,
    },
  };
  const panel = panels[booking.status];
  return (
    <Alert className={panel.tone}>
      {panel.icon}
      <AlertDescription className="text-inherit">
        <span>{panel.text}</span>
      </AlertDescription>
    </Alert>
  );
}

/** What was paid, how, and when — once there is a payment to show. */
function PaymentSummaryCard({ booking }: { booking: CustomerBooking }) {
  const payment = booking.payment;
  if (!payment) return null;
  const paid = booking.status === "confirmed" || booking.status === "completed";
  return (
    <Card>
      <CardHeader>
        <CardTitle>Payment</CardTitle>
        <CardDescription>
          {paid
            ? "This booking is paid for."
            : "The latest payment attempt for this booking."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Amount</dt>
            <dd className="font-medium tabular-nums">
              {formatCurrency(booking.total_amount, booking.currency)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Status</dt>
            <dd>
              <StatusBadge status={payment.status} label={payment.status_label} />
            </dd>
          </div>
          {booking.confirmed_at && (
            <div>
              <dt className="text-xs text-muted-foreground">Paid on</dt>
              <dd className="font-medium">{formatDateTime(booking.confirmed_at)}</dd>
            </div>
          )}
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Reference</dt>
            <dd className="truncate font-mono text-xs">{payment.id}</dd>
          </div>
          {payment.failure_reason && !paid && (
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted-foreground">Last message</dt>
              <dd>{payment.failure_reason}</dd>
            </div>
          )}
        </dl>
      </CardContent>
    </Card>
  );
}

/** Money on its way back, and how far along it is. */
function RefundsCard({ refunds }: { refunds: CustomerBooking["refunds"] }) {
  if (refunds.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{refunds.length === 1 ? "Refund" : "Refunds"}</CardTitle>
        <CardDescription>Refunds go back the way you paid.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y rounded-xl border">
          {refunds.map((refund) => (
            <li key={refund.id} className="space-y-1 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs">{refund.reference}</span>
                <StatusBadge status={refund.status} label={refund.status_label} />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold tabular-nums">
                  {formatCurrency(refund.amount, refund.currency)}
                </span>
                <span className="text-xs text-muted-foreground">
                  Requested {formatDateTime(refund.created_at)}
                </span>
              </div>
              {refund.resolution && (
                <p className="text-xs text-muted-foreground">{refund.resolution}</p>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** The booking review (while unpaid) and, afterwards, the booking's details. */
export function BookingView({ id }: { id: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const query = useQuery({
    queryKey: queryKeys.booking(id),
    queryFn: ({ signal }) => bookingsApi.get(id, signal),
    refetchInterval: (current) => (current.state.data && isUnpaid(current.state.data.status) ? 15_000 : false),
  });
  const booking = query.data;
  const remaining = useCountdown(
    booking && isUnpaid(booking.status) ? booking.seconds_remaining : null,
    query.dataUpdatedAt,
  );
  const ranOut = remaining === 0;

  useEffect(() => {
    if (ranOut) void queryClient.invalidateQueries({ queryKey: queryKeys.booking(id) });
  }, [ranOut, id, queryClient]);

  const store = (data: CustomerBooking) => {
    queryClient.setQueryData(queryKeys.booking(id), data);
    void queryClient.invalidateQueries({ queryKey: queryKeys.allMyBookings });
  };
  const onError = (error: unknown) => {
    toast.error(getErrorMessage(error));
    void query.refetch();
  };
  const checkout = useMutation({
    mutationFn: () => bookingsApi.checkout(id),
    onSuccess: (data) => {
      store(data);
      router.push(`/bookings/${id}/checkout`);
    },
    onError,
  });
  const download = useMutation({
    mutationFn: () => bookingsApi.ticketPdf(id),
    onSuccess: (pdf) =>
      saveBlob(
        pdf,
        `${siteConfig.name.toLowerCase()}-ticket-${booking?.booking_reference ?? id}.pdf`,
      ),
    onError: (error) =>
      toast.error(getErrorMessage(error, "We couldn’t download your ticket. Please try again.")),
  });

  if (query.isPending) {
    return (
      <div className="space-y-6" aria-busy>
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
          <Skeleton className="h-96 rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      </div>
    );
  }
  if (query.isError) {
    return query.error instanceof ApiError && query.error.status === 404 ? (
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
      <ErrorState error={query.error} onRetry={() => void query.refetch()} />
    );
  }

  const data = query.data;
  const pending = data.status === "pending" && !ranOut;
  const unpaid = isUnpaid(data.status) && !ranOut;
  const busy = checkout.isPending || download.isPending;

  const savePassengers = async (passengers: PassengerInput[]) => {
    store(await bookingsApi.updatePassengers(id, passengers));
    setEditing(false);
    toast.success("Passenger details updated.");
  };

  return (
    <div className="space-y-6">
      <BackLink href="/account">My bookings</BackLink>
      <header className="space-y-2">
        <h1 className="text-2xl font-bold sm:text-3xl">{pending ? "Review your booking" : "Your booking"}</h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          Reference <span className="font-mono font-semibold text-foreground">{data.booking_reference}</span>
          <StatusBadge status={data.status} label={data.status_label} />
        </p>
      </header>

      <StatusPanel booking={data} remaining={unpaid ? remaining : null} />
      {data.payment?.requires_refund && (
        <Alert className="border-amber-200 bg-amber-50 text-amber-900">
          <TriangleAlertIcon />
          <AlertDescription className="text-inherit">
            We received a payment we couldn’t use for this booking
            {data.payment.failure_reason && ` (${data.payment.failure_reason.replace(/\.$/, "")})`}. It will be
            refunded to you in full.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
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
              {data.boarding?.time && data.dropoff?.time ? (
                <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-muted/60 p-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Board at</p>
                    <p className="font-semibold">{data.boarding.stop.name}</p>
                    <p className="text-sm">
                      {formatTripDate(data.boarding.time)} · {formatClock(data.boarding.time)}
                    </p>
                  </div>
                  <div className="flex flex-col items-center text-xs text-muted-foreground">
                    <ArrowRightIcon className="size-4" aria-label="to" />
                    {formatJourney(minutesBetween(data.boarding.time, data.dropoff.time))}
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Get off at</p>
                    <p className="font-semibold">{data.dropoff.stop.name}</p>
                    <p className="text-sm">
                      {formatTripDate(data.dropoff.time)} · {formatClock(data.dropoff.time)}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-sm">Departs {formatDateTime(data.trip.departure_datetime)}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <div className="space-y-1.5">
                <CardTitle>Passengers</CardTitle>
                <CardDescription>
                  {data.seats.length === 1 ? "Seat" : "Seats"} {data.seats.join(", ")}
                </CardDescription>
              </div>
              {pending && !editing && (
                <Button variant="outline" size="lg" onClick={() => setEditing(true)}>
                  <PencilIcon data-icon="inline-start" />
                  Edit
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {editing ? (
                <PassengerDetailsForm
                  defaultValues={passengerDefaults(data.seats, user, data.passengers)}
                  submitLabel="Save passengers"
                  onSubmit={savePassengers}
                  onBack={() => setEditing(false)}
                  backLabel="Cancel"
                />
              ) : (
                <ul className="divide-y rounded-xl border">
                  {data.passengers.map((passenger) => (
                    <li key={passenger.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                      <div className="min-w-0">
                        <p className="font-medium">{passenger.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {passenger.phone} · {passenger.email}
                        </p>
                      </div>
                      <span className="rounded-md bg-primary/10 px-2 py-1 text-xs font-semibold text-primary tabular-nums">
                        Seat {passenger.seat_number}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <PaymentSummaryCard booking={data} />
          <RefundsCard refunds={data.refunds} />
        </div>

        <aside className="lg:sticky lg:top-24">
          <Card>
            <CardHeader>
              <CardTitle>Price</CardTitle>
              <CardDescription>Calculated by Yathra — this is what you’ll pay.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <PriceBreakdown quote={data.price} />
              {pending && (
                <Button variant="cta" size="xl" className="w-full" disabled={busy || editing} onClick={() => checkout.mutate()}>
                  {checkout.isPending && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
                  Confirm and continue to payment
                </Button>
              )}
              {data.status === "payment_pending" && !ranOut && (
                <Button asChild variant="cta" size="xl" className="w-full">
                  <Link href={`/bookings/${id}/checkout`}>
                    <CreditCardIcon data-icon="inline-start" />
                    Continue to payment
                  </Link>
                </Button>
              )}
              {data.ticket && (
                <>
                  <Button asChild variant="cta" size="xl" className="w-full">
                    <Link href={`/bookings/${id}/ticket`}>
                      <TicketIcon data-icon="inline-start" />
                      View e-ticket
                    </Link>
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    className="w-full"
                    disabled={download.isPending}
                    onClick={() => download.mutate()}
                  >
                    {download.isPending ? (
                      <Loader2Icon className="animate-spin" data-icon="inline-start" />
                    ) : (
                      <DownloadIcon data-icon="inline-start" />
                    )}
                    Download ticket
                  </Button>
                </>
              )}
              {/* Whether this may be cancelled — and what comes back — is the server's call. */}
              {data.cancellation.allowed && (
                <div className="space-y-1">
                  <Button
                    variant="outline"
                    size="lg"
                    className="w-full"
                    disabled={busy}
                    onClick={() => setCancelling(true)}
                  >
                    Cancel booking
                  </Button>
                  {data.cancellation.refundable && (
                    <p className="text-center text-xs text-muted-foreground">
                      Refund if you cancel now:{" "}
                      {formatCurrency(data.cancellation.refund_amount, data.cancellation.currency)}
                    </p>
                  )}
                </div>
              )}
              {(data.status === "expired" || ranOut) && (
                <Button asChild variant="cta" size="xl" className="w-full">
                  <Link href={`/trips/${data.trip.id}`}>Choose seats again</Link>
                </Button>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
      {cancelling && <CancelBookingDialog booking={data} onClose={() => setCancelling(false)} />}
    </div>
  );
}
