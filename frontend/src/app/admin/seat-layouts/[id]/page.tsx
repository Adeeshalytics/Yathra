import type { Metadata } from "next";

import { SeatLayoutDetail } from "@/components/admin/seat-layouts/seat-layout-detail";

export const metadata: Metadata = { title: "Seat layout" };

export default async function SeatLayoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SeatLayoutDetail id={id} />;
}
