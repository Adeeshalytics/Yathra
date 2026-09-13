import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard } from "@/components/auth/auth-card";
import { LoginPanel } from "@/components/auth/login-panel";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { next } = await searchParams;
  const nextPath = typeof next === "string" ? next : undefined;

  return (
    <AuthCard
      title="Welcome back"
      description="Use your phone number — we’ll text you a code. Operators and admins sign in with email."
      footer={
        <>
          New here? Just use your phone number above, or{" "}
          <Link
            href={nextPath ? `/register?next=${encodeURIComponent(nextPath)}` : "/register"}
            className="font-semibold text-primary underline-offset-4 hover:underline"
          >
            create an account with email
          </Link>
        </>
      }
    >
      <LoginPanel next={nextPath} />
    </AuthCard>
  );
}
