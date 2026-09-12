"use client";

import {
  BusFrontIcon,
  Building2Icon,
  CalendarClockIcon,
  CalendarIcon,
  ChartColumnIcon,
  CreditCardIcon,
  Grid3x3Icon,
  LayoutDashboardIcon,
  MapPinIcon,
  MenuIcon,
  RepeatIcon,
  RouteIcon,
  SettingsIcon,
  TicketIcon,
  Undo2Icon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType, ReactNode } from "react";

import { Logo } from "@/components/brand/logo";
import { Badge } from "@/components/ui/badge";
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
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

import { SkipLink } from "./skip-link";
import { UserMenu } from "./user-menu";

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Planned sections render disabled until they ship. */
  comingSoon?: boolean;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const AREAS = {
  admin: {
    title: "Admin console",
    home: "/admin",
    sections: [
      {
        title: "Overview",
        items: [{ href: "/admin", label: "Dashboard", icon: LayoutDashboardIcon }],
      },
      {
        title: "Network & fleet",
        items: [
          { href: "/admin/operators", label: "Operators", icon: Building2Icon },
          { href: "/admin/buses", label: "Buses", icon: BusFrontIcon },
          { href: "/admin/seat-layouts", label: "Seat Layouts", icon: Grid3x3Icon },
          { href: "/admin/routes", label: "Routes", icon: RouteIcon },
          { href: "/admin/stops", label: "Stops", icon: MapPinIcon },
        ],
      },
      {
        title: "Scheduling",
        items: [
          { href: "/admin/trips", label: "Trips", icon: CalendarClockIcon },
          { href: "/admin/schedules", label: "Schedules", icon: RepeatIcon },
        ],
      },
      {
        title: "Sales",
        items: [
          { href: "/admin/bookings", label: "Bookings", icon: TicketIcon },
          { href: "/admin/passengers", label: "Passengers", icon: UsersIcon },
          { href: "/admin/payments", label: "Payments", icon: CreditCardIcon },
          { href: "/admin/refunds", label: "Refunds", icon: Undo2Icon },
        ],
      },
      {
        title: "System",
        items: [
          { href: "/admin/reports", label: "Reports", icon: ChartColumnIcon },
          { href: "/admin/settings", label: "Settings", icon: SettingsIcon, comingSoon: true },
        ],
      },
    ],
  },
  operator: {
    title: "Operator portal",
    home: "/operator",
    sections: [
      {
        title: "Operator portal",
        items: [
          { href: "/operator", label: "Overview", icon: LayoutDashboardIcon },
          { href: "/operator/fleet", label: "Fleet", icon: BusFrontIcon, comingSoon: true },
          { href: "/operator/trips", label: "Trips", icon: CalendarIcon, comingSoon: true },
          { href: "/operator/bookings", label: "Bookings", icon: TicketIcon, comingSoon: true },
        ],
      },
    ],
  },
} satisfies Record<string, { title: string; home: string; sections: NavSection[] }>;

export type DashboardArea = keyof typeof AREAS;

function isActive(href: string, home: string, pathname: string): boolean {
  if (href === home) return pathname === home;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SidebarNav({
  sections,
  home,
  pathname,
  inSheet = false,
}: {
  sections: NavSection[];
  home: string;
  pathname: string;
  inSheet?: boolean;
}) {
  return (
    <div className="flex flex-col gap-5">
      {sections.map((section) => (
        <div key={section.title}>
          <p className="px-3 pb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            {section.title}
          </p>
          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href, home, pathname);
              const classes = cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
              );

              if (item.comingSoon) {
                return (
                  <li key={item.href}>
                    <span
                      aria-disabled
                      className={cn(classes, "cursor-not-allowed opacity-55 hover:bg-transparent")}
                    >
                      <Icon className="size-4" />
                      {item.label}
                      <Badge variant="outline" className="ml-auto text-[10px]">
                        Soon
                      </Badge>
                    </span>
                  </li>
                );
              }

              const link = (
                <Link href={item.href} aria-current={active ? "page" : undefined} className={classes}>
                  <Icon className="size-4" />
                  {item.label}
                </Link>
              );
              return (
                <li key={item.href}>{inSheet ? <SheetClose asChild>{link}</SheetClose> : link}</li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Layout frame for the admin console and operator portal: sidebar on desktop, sheet on mobile. */
export function DashboardShell({ area, children }: { area: DashboardArea; children: ReactNode }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const { title, home, sections } = AREAS[area];

  return (
    <div className="flex min-h-svh flex-1 bg-muted/40">
      <SkipLink />
      <aside className="sticky top-0 hidden h-svh w-64 shrink-0 flex-col border-r bg-sidebar lg:flex">
        <div className="flex h-16 items-center border-b px-5">
          <Logo href={home} />
        </div>
        <nav aria-label={title} className="flex-1 overflow-y-auto p-3 pt-4">
          <SidebarNav sections={sections} home={home} pathname={pathname} />
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur sm:px-6">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon-lg" className="lg:hidden">
                <MenuIcon />
                <span className="sr-only">Open navigation</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 overflow-y-auto bg-sidebar">
              <SheetHeader className="border-b">
                <SheetTitle>{title}</SheetTitle>
                <SheetDescription className="sr-only">Section navigation</SheetDescription>
              </SheetHeader>
              <nav aria-label={title} className="px-3 pb-6">
                <SidebarNav sections={sections} home={home} pathname={pathname} inSheet />
              </nav>
            </SheetContent>
          </Sheet>
          <span className="font-heading font-semibold lg:hidden">{title}</span>
          <div className="ml-auto flex items-center gap-2">
            <Button asChild variant="ghost" size="lg" className="hidden sm:inline-flex">
              <Link href="/">View site</Link>
            </Button>
            {user && <UserMenu user={user} />}
          </div>
        </header>
        <main id="main-content" className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
