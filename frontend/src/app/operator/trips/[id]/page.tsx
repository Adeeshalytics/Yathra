import type { Metadata } from "next";

import { OperatorTripDetail } from "@/components/operator/operator-trip-detail";

export const metadata: Metadata = { title: "Trip" };

export default async function OperatorTripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OperatorTripDetail id={id} />;
}
