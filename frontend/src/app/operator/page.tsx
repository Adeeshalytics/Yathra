import type { Metadata } from "next";

import { OperatorDashboard } from "@/components/operator/operator-dashboard";

export const metadata: Metadata = { title: "Overview" };

export default function OperatorHomePage() {
  return <OperatorDashboard />;
}
