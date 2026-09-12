import type { Metadata } from "next";
import { Suspense } from "react";

import { TripView, TripViewSkeleton } from "@/components/trip/trip-view";

export const metadata: Metadata = { title: "Choose your seats" };

export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<TripViewSkeleton />}>
      <TripView id={id} />
    </Suspense>
  );
}
