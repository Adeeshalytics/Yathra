import type { Metadata } from "next";

import { OperatorCreateView } from "@/components/admin/operators/operator-editor";

export const metadata: Metadata = { title: "Add operator" };

export default function NewOperatorPage() {
  return <OperatorCreateView />;
}
