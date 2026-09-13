import type { Metadata } from "next";

import { OperatorTrips } from "@/components/operator/operator-trips";

export const metadata: Metadata = { title: "Trips" };

export default function OperatorTripsPage() {
  return <OperatorTrips />;
}
