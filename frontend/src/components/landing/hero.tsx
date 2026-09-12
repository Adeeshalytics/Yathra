import { BadgeCheckIcon, BusFrontIcon, ShieldCheckIcon, TicketIcon } from "lucide-react";

import { HillsBackdrop } from "@/components/brand/hills-backdrop";

import { TripSearchForm } from "./trip-search-form";

const HIGHLIGHTS = [
  { icon: BadgeCheckIcon, label: "Licensed operators" },
  { icon: ShieldCheckIcon, label: "Secure checkout" },
  { icon: TicketIcon, label: "Mobile tickets" },
];

export function Hero() {
  return (
    <section
      aria-labelledby="hero-heading"
      className="relative isolate overflow-hidden bg-linear-to-br from-[oklch(0.3_0.06_205)] via-[oklch(0.37_0.075_196)] to-[oklch(0.45_0.09_186)] text-white"
    >
      <HillsBackdrop />
      <div className="container-page relative grid gap-10 pt-12 pb-20 sm:pt-16 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-14 lg:pt-20 lg:pb-28">
        <div className="max-w-xl">
          <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-sm font-medium ring-1 ring-white/20">
            <BusFrontIcon className="size-4 text-saffron" aria-hidden />
            Intercity buses across Sri Lanka
          </p>
          <h1
            id="hero-heading"
            className="mt-5 text-4xl leading-[1.08] font-extrabold sm:text-5xl lg:text-6xl"
          >
            Your seat on the road <span className="text-saffron">to anywhere</span> in Sri Lanka.
          </h1>
          <p className="mt-5 text-lg text-white/85">
            Compare operators, choose your seat and travel with a ticket on your phone — from
            Colombo to Jaffna, Galle to Trincomalee.
          </p>
          <ul className="mt-7 flex flex-wrap gap-x-6 gap-y-3 text-sm font-medium text-white/90">
            {HIGHLIGHTS.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-2">
                <Icon className="size-4 text-saffron" aria-hidden />
                {label}
              </li>
            ))}
          </ul>
        </div>

        <div
          id="search"
          className="scroll-mt-24 rounded-3xl bg-card p-5 text-card-foreground shadow-2xl shadow-black/20 ring-1 ring-black/5 sm:p-7"
        >
          <h2 className="text-xl font-bold">Find your bus</h2>
          <p className="mt-1 mb-5 text-sm text-muted-foreground">
            Pick your route and date to see available departures.
          </p>
          <TripSearchForm />
        </div>
      </div>
    </section>
  );
}
