import type { Metadata } from "next";

import { TripCreateView } from "@/components/admin/trips/trip-editor";

export const metadata: Metadata = { title: "New trip" };

export default function NewTripPage() {
  return <TripCreateView />;
}
