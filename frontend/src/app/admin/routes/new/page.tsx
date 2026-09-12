import type { Metadata } from "next";

import { RouteCreateView } from "@/components/admin/routes/route-views";

export const metadata: Metadata = { title: "New route" };

export default function NewRoutePage() {
  return <RouteCreateView />;
}
