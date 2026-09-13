import type { Metadata } from "next";

import { OperatorRevenue } from "@/components/operator/operator-revenue";

export const metadata: Metadata = { title: "Revenue" };

export default function OperatorRevenuePage() {
  return <OperatorRevenue />;
}
