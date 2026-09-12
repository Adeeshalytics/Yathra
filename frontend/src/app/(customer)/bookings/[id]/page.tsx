import type { Metadata } from "next";

import { BookingView } from "@/components/booking/booking-view";

export const metadata: Metadata = { title: "Your booking" };

export default async function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BookingView id={id} />;
}
