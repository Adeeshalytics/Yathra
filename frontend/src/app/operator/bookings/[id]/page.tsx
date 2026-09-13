import type { Metadata } from "next";

import { OperatorBookingDetail } from "@/components/operator/operator-booking-detail";

export const metadata: Metadata = { title: "Booking" };

export default async function OperatorBookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OperatorBookingDetail id={id} />;
}
