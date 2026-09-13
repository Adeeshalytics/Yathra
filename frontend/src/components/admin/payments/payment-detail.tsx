"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2Icon, RefreshCwIcon, TriangleAlertIcon, Undo2Icon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { DetailList } from "@/components/admin/shared/detail-list";
import { BackLink, DetailSkeleton, RecordError } from "@/components/admin/shared/page-parts";
import { StatusBadge } from "@/components/common/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAdminMutation } from "@/hooks/use-admin-mutation";
import { adminApi } from "@/lib/api/admin";
import type { AdminPaymentDetail, PaymentEvent } from "@/lib/api/payment-types";
import { queryKeys } from "@/lib/api/query-keys";
import { formatCurrency, formatDateTime } from "@/lib/format";

import { NeedsRefundBadge } from "./payments-list";
import { RefundDialog } from "./refund-dialog";

function EventData({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([, value]) => value !== "" && value !== null && value !== undefined);
  if (entries.length === 0) return null;
  return (
    <dl className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-xs text-muted-foreground">
      {entries.map(([key, value]) => (
        <div key={key}>
          <dt className="inline">{key}:</dt> <dd className="inline">{String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** "partially_refunded" → "Partially refunded" (the shared badge's default wording is for accounts). */
function statusWord(status: string): string {
  const words = status.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function Timeline({ events }: { events: PaymentEvent[] }) {
  if (events.length === 0) return <p className="text-sm text-muted-foreground">Nothing has happened yet.</p>;
  return (
    <ol className="space-y-4 border-l pl-4">
      {events.map((event) => (
        <li key={event.id} className="relative">
          <span className="absolute top-1.5 -left-[1.3rem] size-2 rounded-full bg-primary" aria-hidden />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{event.source_label}</span>
            {event.status && <StatusBadge status={event.status} label={statusWord(event.status)} />}
            {event.outcome !== "applied" && <StatusBadge status={event.outcome} label={event.outcome_label} />}
            <time className="text-xs text-muted-foreground" dateTime={event.created_at}>
              {formatDateTime(event.created_at)}
            </time>
          </div>
          {event.message && <p className="text-sm text-muted-foreground">{event.message}</p>}
          <EventData data={event.data} />
        </li>
      ))}
    </ol>
  );
}

function money(payment: AdminPaymentDetail, amount: string) {
  return formatCurrency(amount, payment.currency);
}

export function PaymentDetail({ id }: { id: string }) {
  const [refunding, setRefunding] = useState(false);
  const query = useQuery({
    queryKey: queryKeys.admin.detail("payments", id),
    queryFn: ({ signal }) => adminApi.payments.get(id, signal),
  });
  const reconcile = useAdminMutation({
    mutationFn: () => adminApi.payments.reconcile(id),
    successMessage: (data) => `Checked with ${data.provider_name}: ${data.status_label.toLowerCase()}.`,
  });

  if (query.isPending) return <DetailSkeleton />;
  if (query.isError) {
    return <RecordError error={query.error} noun="payment" backHref="/admin/payments" onRetry={() => void query.refetch()} />;
  }

  const payment = query.data;
  const canRefund = Number(payment.refundable_amount) > 0 || payment.requires_refund;
  const canCheck = payment.provider !== "manual" && payment.status !== "refunded";
  const booking = payment.booking_detail;

  return (
    <div className="space-y-6">
      <BackLink href="/admin/payments">Payments</BackLink>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h1 className="font-mono text-2xl font-bold break-all">{payment.transaction_reference}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <StatusBadge status={payment.status} label={payment.status_label} />
            {payment.requires_refund && <NeedsRefundBadge />}
            <span>
              {money(payment, payment.amount)} via {payment.provider_name}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canCheck && (
            <Button variant="outline" size="lg" onClick={() => reconcile.mutate()} disabled={reconcile.isPending}>
              {reconcile.isPending ? (
                <Loader2Icon className="animate-spin" data-icon="inline-start" />
              ) : (
                <RefreshCwIcon data-icon="inline-start" />
              )}
              Check with gateway
            </Button>
          )}
          {canRefund && (
            <Button variant="destructive" size="lg" onClick={() => setRefunding(true)}>
              <Undo2Icon data-icon="inline-start" />
              Refund
            </Button>
          )}
        </div>
      </header>

      {payment.requires_refund && (
        <Alert className="border-amber-200 bg-amber-50 text-amber-900">
          <TriangleAlertIcon />
          <AlertDescription className="text-inherit">
            The customer paid but this payment couldn’t be used{payment.failure_reason ? `: ${payment.failure_reason}` : "."}{" "}
            Refund it.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Payment</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList
              items={[
                { label: "Amount", value: money(payment, payment.amount) },
                {
                  label: "Refunded",
                  value: Number(payment.refunded_amount) > 0 ? money(payment, payment.refunded_amount) : "—",
                },
                { label: "Gateway", value: payment.provider_name },
                { label: "Method", value: payment.payment_method_label || "—" },
                {
                  label: "Gateway reference",
                  value: payment.provider_reference ? <span className="font-mono">{payment.provider_reference}</span> : "—",
                },
                { label: "Started", value: formatDateTime(payment.created_at) },
                { label: "Paid", value: payment.paid_at ? formatDateTime(payment.paid_at) : "—" },
                { label: "Refunded on", value: payment.refunded_at ? formatDateTime(payment.refunded_at) : "—" },
                ...(payment.failure_reason && !payment.requires_refund
                  ? [{ label: "Reason", value: payment.failure_reason, wide: true }]
                  : []),
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Booking</CardTitle>
            <CardDescription>{payment.customer.email || payment.customer.phone}</CardDescription>
          </CardHeader>
          <CardContent>
            <DetailList
              items={[
                { label: "Booking reference", value: <span className="font-mono">{booking.booking_reference}</span> },
                { label: "Status", value: <StatusBadge status={booking.status} label={booking.status_label} /> },
                { label: "Customer", value: payment.customer.name },
                { label: "Seats", value: booking.seats.join(", ") || "—" },
                {
                  label: "Trip",
                  value: (
                    <Link href={`/admin/trips/${payment.trip.id}`} className="hover:underline">
                      {payment.trip.code} · {payment.trip.route}
                    </Link>
                  ),
                  wide: true,
                },
                { label: "Departure", value: formatDateTime(payment.trip.departure_datetime) },
                { label: "Booking total", value: formatCurrency(booking.total_amount, booking.currency) },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
          <CardDescription>Checkout, gateway notifications, status checks and refunds, oldest first.</CardDescription>
        </CardHeader>
        <CardContent>
          <Timeline events={payment.events} />
        </CardContent>
      </Card>

      {refunding && <RefundDialog payment={payment} onClose={() => setRefunding(false)} />}
    </div>
  );
}
