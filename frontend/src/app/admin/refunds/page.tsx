import type { Metadata } from "next";

import { RefundsList } from "@/components/admin/refunds/refunds-list";

export const metadata: Metadata = { title: "Refunds" };

export default function RefundsPage() {
  return <RefundsList />;
}
