import type { Metadata } from "next";

import { RoutesList } from "@/components/admin/routes/routes-list";

export const metadata: Metadata = { title: "Routes" };

export default function RoutesPage() {
  return <RoutesList />;
}
