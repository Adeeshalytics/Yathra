import type { Metadata } from "next";
import type { ReactNode } from "react";

import { RequireAuth } from "@/components/auth/require-auth";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { OperatorGate } from "@/components/operator/operator-gate";

export const metadata: Metadata = {
  title: { default: "Operator portal", template: "%s · Operator portal" },
  robots: { index: false, follow: false },
};

export default function OperatorLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth roles={["operator"]}>
      <DashboardShell area="operator">
        <OperatorGate>{children}</OperatorGate>
      </DashboardShell>
    </RequireAuth>
  );
}
