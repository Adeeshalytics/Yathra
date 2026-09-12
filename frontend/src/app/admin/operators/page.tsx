import type { Metadata } from "next";

import { OperatorsList } from "@/components/admin/operators/operators-list";

export const metadata: Metadata = { title: "Operators" };

export default function OperatorsPage() {
  return <OperatorsList />;
}
