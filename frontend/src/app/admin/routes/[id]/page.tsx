import type { Metadata } from "next";

import { RouteDetail } from "@/components/admin/routes/route-detail";

export const metadata: Metadata = { title: "Route" };

export default async function RoutePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RouteDetail id={id} />;
}
