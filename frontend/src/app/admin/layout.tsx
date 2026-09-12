import type { Metadata } from "next";
import type { ReactNode } from "react";

import { RequireAuth } from "@/components/auth/require-auth";
import { DashboardShell } from "@/components/layout/dashboard-shell";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Admin" },
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth roles={["admin"]}>
      <DashboardShell area="admin">{children}</DashboardShell>
    </RequireAuth>
  );
}
