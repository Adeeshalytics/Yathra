import type { Metadata } from "next";

import { TripManifestView } from "@/components/admin/passengers/trip-manifest";

export const metadata: Metadata = { title: "Manifest" };

export default async function OperatorManifestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TripManifestView tripId={id} scope="operator" />;
}
