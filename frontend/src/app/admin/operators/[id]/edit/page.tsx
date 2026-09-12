import type { Metadata } from "next";

import { OperatorEditView } from "@/components/admin/operators/operator-editor";

export const metadata: Metadata = { title: "Edit operator" };

export default async function EditOperatorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OperatorEditView id={id} />;
}
