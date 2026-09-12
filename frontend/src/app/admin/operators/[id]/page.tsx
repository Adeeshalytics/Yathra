import type { Metadata } from "next";

import { OperatorDetail } from "@/components/admin/operators/operator-detail";

export const metadata: Metadata = { title: "Operator" };

export default async function OperatorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OperatorDetail id={id} />;
}
