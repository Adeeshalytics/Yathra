"use client";

import { MenuIcon } from "lucide-react";
import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { ROLE_HOME } from "@/lib/auth/roles";
import { siteConfig } from "@/lib/site";

import { SkipLink } from "./skip-link";
import { UserMenu } from "./user-menu";

const NAV_LINKS = [
  { href: "/#popular-routes", label: "Routes" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#why-us", label: "Why us" },
  { href: "/find-booking", label: "Find my booking" },
];

export function SiteHeader() {
  const { status, user } = useAuth();

  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-backdrop-filter:bg-background/75 print:hidden">
      {/* Flag-inspired accent stripe. */}
      <div aria-hidden className="h-1 bg-linear-to-r from-maroon via-saffron to-primary" />
      <SkipLink />
      <div className="container-page flex h-16 items-center justify-between gap-4">
        <Logo />

        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => (
            <Button key={link.href} asChild variant="ghost" size="lg">
              <Link href={link.href}>{link.label}</Link>
            </Button>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {status === "loading" && <Skeleton className="h-9 w-28 rounded-full" />}
          {status === "unauthenticated" && (
            <div className="hidden items-center gap-2 sm:flex">
              <Button asChild variant="ghost" size="lg">
                <Link href="/login">Sign in</Link>
              </Button>
              <Button asChild size="lg">
                <Link href="/register">Create account</Link>
              </Button>
            </div>
          )}
          {status === "authenticated" && user && <UserMenu user={user} />}

          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon-lg" className="md:hidden">
                <MenuIcon />
                <span className="sr-only">Open menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-80">
              <SheetHeader className="border-b">
                <SheetTitle>{siteConfig.name}</SheetTitle>
                <SheetDescription>{siteConfig.tagline}</SheetDescription>
              </SheetHeader>
              <nav aria-label="Mobile" className="flex flex-col gap-1 px-2">
                {NAV_LINKS.map((link) => (
                  <SheetClose key={link.href} asChild>
                    <Link
                      href={link.href}
                      className="rounded-lg px-3 py-3 text-base font-medium hover:bg-muted"
                    >
                      {link.label}
                    </Link>
                  </SheetClose>
                ))}
              </nav>
              <div className="mt-auto flex flex-col gap-2 border-t p-4">
                {status === "authenticated" && user ? (
                  <SheetClose asChild>
                    <Button asChild size="xl">
                      <Link href={ROLE_HOME[user.role]}>
                        {user.role === "customer" ? "My account" : "Dashboard"}
                      </Link>
                    </Button>
                  </SheetClose>
                ) : (
                  <>
                    <SheetClose asChild>
                      <Button asChild size="xl">
                        <Link href="/register">Create account</Link>
                      </Button>
                    </SheetClose>
                    <SheetClose asChild>
                      <Button asChild size="xl" variant="outline">
                        <Link href="/login">Sign in</Link>
                      </Button>
                    </SheetClose>
                  </>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
