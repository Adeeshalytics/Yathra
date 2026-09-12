import type { ReactNode } from "react";

import { HillsBackdrop } from "@/components/brand/hills-backdrop";
import { Logo } from "@/components/brand/logo";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-svh flex-1 lg:grid-cols-2">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-linear-to-br from-[oklch(0.3_0.06_205)] via-[oklch(0.37_0.075_196)] to-[oklch(0.45_0.09_186)] p-10 text-white lg:flex">
        <Logo tone="inverse" />
        <div className="relative max-w-md space-y-4 pb-24">
          <p className="text-3xl leading-snug font-bold">
            From the hill country to the coast — your seat is a few taps away.
          </p>
          <p className="text-white/80">
            One account for booking trips, keeping tickets on your phone and managing every
            journey.
          </p>
        </div>
        <HillsBackdrop />
      </aside>

      <main id="main-content" className="flex flex-col px-4 py-6 sm:px-8">
        <div className="lg:hidden">
          <Logo />
        </div>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">
          {children}
        </div>
      </main>
    </div>
  );
}
