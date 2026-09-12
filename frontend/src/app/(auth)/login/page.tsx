import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard } from "@/components/auth/auth-card";
import { LoginForm } from "@/components/auth/login-form";

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
      description="Sign in to your customer, operator or admin account."
      footer={
        <>
          New here?{" "}
          <Link
            href={nextPath ? `/register?next=${encodeURIComponent(nextPath)}` : "/register"}
            className="font-semibold text-primary underline-offset-4 hover:underline"
          >
            Create an account
          </Link>
        </>
      }
    >
      <LoginForm next={nextPath} />
    </AuthCard>
  );
}
