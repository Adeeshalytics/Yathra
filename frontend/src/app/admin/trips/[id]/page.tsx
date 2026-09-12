import type { Metadata } from "next";

import { TripDetail } from "@/components/admin/trips/trip-detail";

export const metadata: Metadata = { title: "Trip" };

export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TripDetail id={id} />;
}
