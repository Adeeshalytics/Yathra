import type { Metadata } from "next";

import { TripManifestView } from "@/components/admin/passengers/trip-manifest";

export const metadata: Metadata = { title: "Passenger manifest" };

export default async function TripManifestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TripManifestView tripId={id} />;
}
