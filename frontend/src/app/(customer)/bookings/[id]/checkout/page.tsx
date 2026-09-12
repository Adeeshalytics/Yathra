import type { Metadata } from "next";

import { CheckoutView } from "@/components/booking/checkout-view";

export const metadata: Metadata = { title: "Payment" };

export default async function CheckoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CheckoutView id={id} />;
}
