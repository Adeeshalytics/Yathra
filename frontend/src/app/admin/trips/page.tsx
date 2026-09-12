import type { Metadata } from "next";

import { TripsList } from "@/components/admin/trips/trips-list";

export const metadata: Metadata = { title: "Trips" };

export default function TripsPage() {
  return <TripsList />;
}
