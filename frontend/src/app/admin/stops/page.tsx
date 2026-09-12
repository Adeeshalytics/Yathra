import type { Metadata } from "next";

import { StopsManager } from "@/components/admin/stops/stops-manager";

export const metadata: Metadata = { title: "Stops" };

export default function StopsPage() {
  return <StopsManager />;
}
