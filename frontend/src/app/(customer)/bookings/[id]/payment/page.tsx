import type { Metadata } from "next";

import { PaymentStatusView } from "@/components/booking/payment-status-view";

export const metadata: Metadata = { title: "Payment status" };

/** The payment gateway sends customers back here: ?payment=<id> (and &cancelled=1). */
export default async function PaymentStatusPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const payment = typeof query.payment === "string" ? query.payment : null;
  return <PaymentStatusView bookingId={id} paymentId={payment} cancelled={query.cancelled === "1"} />;
}
