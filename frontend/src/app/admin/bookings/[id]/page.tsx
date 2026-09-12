import type { Metadata } from "next";

import { AdminBookingDetail } from "@/components/admin/bookings/booking-detail";

export const metadata: Metadata = { title: "Booking" };

export default async function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminBookingDetail id={id} />;
}
