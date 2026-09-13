"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { BOARDING_LABELS } from "@/components/admin/bookings/booking-options";
import { DetailList } from "@/components/admin/shared/detail-list";
import { BackLink, DetailSkeleton, RecordError } from "@/components/admin/shared/page-parts";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { operatorApi } from "@/lib/api/endpoints";
import { queryKeys } from "@/lib/api/query-keys";
import { formatClock } from "@/lib/datetime";
import { formatCurrency, formatDateTime } from "@/lib/format";

function Phone({ number }: { number: string }) {
  return number ? (
    <a href={`tel:${number}`} className="hover:underline">
      {number}
    </a>
  ) : (
    <>—</>
  );
}

/** One booking on the company's trip: who, which seats, where they board, and what was paid. */
export function OperatorBookingDetail({ id }: { id: string }) {
  const query = useQuery({
    queryKey: queryKeys.operator.booking(id),
    queryFn: ({ signal }) => operatorApi.bookings.get(id, signal),
  });

  if (query.isPending) return <DetailSkeleton />;
  if (query.isError) {
    return (
      <RecordError
        error={query.error}
        noun="booking"
        backHref="/operator/bookings"
        onRetry={() => void query.refetch()}
      />
    );
  }

  const booking = query.data;
  const money = (amount: string) => formatCurrency(amount, booking.currency);
  return (
    <div className="space-y-6">
      <BackLink href="/operator/bookings">Bookings</BackLink>
      <PageHeader
        title={<span className="font-mono">{booking.booking_reference}</span>}
        description={`${booking.route_name} · booked ${formatDateTime(booking.created_at)}`}
        actions={<StatusBadge status={booking.status} label={booking.status_label} className="h-7 px-3 text-sm" />}
      />

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <Card>
          <CardHeader>
            <CardTitle>Journey</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList
              items={[
                {
                  label: "Trip",
                  value: (
                    <Link href={`/operator/trips/${booking.trip_details.id}`} className="hover:underline">
                      {booking.trip_details.code} · {formatDateTime(booking.trip_details.departure_datetime)}
                    </Link>
                  ),
                  wide: true,
                },
                {
                  label: "Boarding",
                  value: booking.boarding
                    ? `${booking.boarding.name}${booking.boarding.time ? `, ${formatClock(booking.boarding.time)}` : ""}`
                    : "—",
                },
                {
                  label: "Drop-off",
                  value: booking.dropoff
                    ? `${booking.dropoff.name}${booking.dropoff.time ? `, ${formatClock(booking.dropoff.time)}` : ""}`
                    : "—",
                },
                { label: "Bus", value: <span className="font-mono">{booking.trip_details.bus_registration}</span> },
                { label: "Ticket", value: booking.ticket ? booking.ticket.ticket_number : "Not issued (unpaid)" },
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Customer &amp; payment</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList
              items={[
                { label: "Booked by", value: booking.customer.name || "—" },
                { label: "Phone", value: <Phone number={booking.customer.phone} /> },
                { label: "Total", value: money(booking.total_amount) },
                { label: "Paid", value: money(booking.paid_amount) },
                {
                  label: "Payment",
                  value: booking.payment_status ? <StatusBadge status={booking.payment_status} /> : "Not started",
                },
                ...(booking.cancelled_at
                  ? [
                      {
                        label: "Cancelled",
                        value: `${formatDateTime(booking.cancelled_at)}${booking.cancellation_reason ? ` · ${booking.cancellation_reason}` : ""}`,
                        wide: true,
                      },
                    ]
                  : []),
                ...booking.refunds.map((refund, index) => ({
                  label: `Refund ${index + 1}`,
                  value: `${money(refund.amount)} · ${refund.status_label}`,
                })),
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Passengers</CardTitle>
          <CardDescription>Call a passenger who hasn’t turned up before the bus leaves.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th scope="col" className="w-16 pb-2 font-medium">Seat</th>
                <th scope="col" className="pb-2 font-medium">Name</th>
                <th scope="col" className="pb-2 font-medium">Phone</th>
                <th scope="col" className="pb-2 font-medium">Boarding</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {booking.passengers.map((passenger) => (
                <tr key={passenger.id}>
                  <td className="py-2 font-mono font-semibold">{passenger.seat_number}</td>
                  <td className="py-2">{passenger.name}</td>
                  <td className="py-2 whitespace-nowrap">
                    <Phone number={passenger.phone} />
                  </td>
                  <td className="py-2">{BOARDING_LABELS[passenger.boarding_status] ?? passenger.boarding_status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
