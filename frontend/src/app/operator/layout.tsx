import type { Metadata } from "next";
import type { ReactNode } from "react";

import { RequireAuth } from "@/components/auth/require-auth";
import { DashboardShell } from "@/components/layout/dashboard-shell";

export const metadata: Metadata = {
  title: { default: "Operator portal", template: "%s · Operator portal" },
  robots: { index: false, follow: false },
};

export default function OperatorLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth roles={["operator"]}>
      <DashboardShell area="operator">{children}</DashboardShell>
    </RequireAuth>
  );
}
