import type { ReactNode } from "react";

import { RequireAuth } from "@/components/auth/require-auth";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";

export default function CustomerLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="flex flex-1 flex-col bg-muted/30">
        <RequireAuth roles={["customer"]}>
          <div className="container-page py-8 sm:py-12">{children}</div>
        </RequireAuth>
      </main>
      <SiteFooter />
    </>
  );
}
