import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { siteConfig } from "@/lib/site";

// Evaluated when the page is built/rendered on the server.
const CURRENT_YEAR = new Date().getFullYear();

const FOOTER_LINKS = [
  {
    title: "Travel",
    links: [
      { href: "/#search", label: "Search buses" },
      { href: "/#popular-routes", label: "Popular routes" },
      { href: "/#how-it-works", label: "How it works" },
    ],
  },
  {
    title: "Your account",
    links: [
      { href: "/login", label: "Sign in" },
      { href: "/register", label: "Create account" },
      { href: "/account", label: "My bookings" },
    ],
  },
  {
    title: "Bus operators",
    links: [
      { href: "/login?next=/operator", label: "Operator sign in" },
      { href: "/#why-us", label: "Why travellers choose us" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t bg-[oklch(0.24_0.03_205)] text-white/80 print:hidden">
      <div className="container-page grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="space-y-4">
          <Logo tone="inverse" />
          <p className="max-w-xs text-sm leading-relaxed">
            {siteConfig.description} Fares are shown in Sri Lankan Rupees (LKR).
          </p>
        </div>
        {FOOTER_LINKS.map((group) => (
          <nav key={group.title} aria-label={group.title} className="space-y-3">
            <h2 className="text-sm font-semibold text-white">{group.title}</h2>
            <ul className="space-y-2 text-sm">
              {group.links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="rounded transition-colors hover:text-saffron focus-visible:ring-2 focus-visible:ring-saffron/60 focus-visible:outline-none"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-white/10">
        <div className="container-page flex flex-col gap-2 py-5 text-xs text-white/60 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {CURRENT_YEAR} {siteConfig.name}. All rights reserved.
          </p>
          <p>Made for travellers across Sri Lanka 🇱🇰</p>
        </div>
      </div>
    </footer>
  );
}
