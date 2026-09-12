"use client";

import { LockIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { EmptyState } from "@/components/common/empty-state";
import { PageLoader } from "@/components/common/spinner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import type { UserRole } from "@/lib/api/types";
import { ROLE_HOME } from "@/lib/auth/roles";

/**
 * Client-side guard for role-specific areas. This is a UX layer only: the API enforces the
 * same roles on every request, so hiding a page here is never the security boundary.
 */
export function RequireAuth({
  roles,
  children,
}: {
  roles: readonly UserRole[];
  children: ReactNode;
}) {
  const { status, user, reason } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status !== "unauthenticated") return;
    router.replace(reason === "logout" ? "/" : `/login?next=${encodeURIComponent(pathname)}`);
  }, [status, reason, router, pathname]);

  if (status !== "authenticated" || !user) {
    return <PageLoader label="Checking your session…" />;
  }

  if (!roles.includes(user.role)) {
    return (
      <div className="container-page flex flex-1 items-center justify-center py-16">
        <EmptyState
          icon={LockIcon}
          title="You don’t have access to this area"
          description="This section belongs to a different type of account."
          action={
            <Button asChild>
              <Link href={ROLE_HOME[user.role]}>Go to my dashboard</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return <>{children}</>;
}

/** Sends signed-in users away from guest-only pages (login, register) to where they belong. */
export function RedirectIfAuthenticated({ to }: { to: (role: UserRole) => string }) {
  const { status, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated" && user) router.replace(to(user.role));
  }, [status, user, router, to]);

  return null;
}
