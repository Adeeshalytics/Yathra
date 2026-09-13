import type { Metadata } from "next";
import { Suspense } from "react";

import { OperatorBookings } from "@/components/operator/operator-bookings";

export const metadata: Metadata = { title: "Bookings" };

export default function OperatorBookingsPage() {
  // Reads ?trip= from the address, so it renders on the client.
  return (
    <Suspense>
      <OperatorBookings />
    </Suspense>
  );
}
