import type { Metadata } from "next";

import { TripEditView } from "@/components/admin/trips/trip-editor";

export const metadata: Metadata = { title: "Edit trip" };

export default async function EditTripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TripEditView id={id} />;
}
