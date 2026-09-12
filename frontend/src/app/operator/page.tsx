import type { Metadata } from "next";

import { OperatorOverview } from "@/components/operator/operator-overview";

export const metadata: Metadata = { title: "Overview" };

export default function OperatorHomePage() {
  return <OperatorOverview />;
}
