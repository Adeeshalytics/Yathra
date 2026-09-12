import type { Metadata } from "next";

import { PaymentDetail } from "@/components/admin/payments/payment-detail";

export const metadata: Metadata = { title: "Payment" };

export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PaymentDetail id={id} />;
}
