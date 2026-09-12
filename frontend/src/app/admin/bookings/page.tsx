import type { Metadata } from "next";

import { BookingsList } from "@/components/admin/bookings/bookings-list";

export const metadata: Metadata = { title: "Bookings" };

export default function BookingsPage() {
  return <BookingsList />;
}
