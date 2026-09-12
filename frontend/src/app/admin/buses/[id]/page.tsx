import type { Metadata } from "next";

import { BusDetail } from "@/components/admin/buses/bus-detail";

export const metadata: Metadata = { title: "Bus" };

export default async function BusPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BusDetail id={id} />;
}
