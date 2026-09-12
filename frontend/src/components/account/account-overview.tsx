"use client";

import { useQuery } from "@tanstack/react-query";
import {
  BanIcon,
  CalendarCheckIcon,
  HistoryIcon,
  MailIcon,
  PencilIcon,
  PhoneIcon,
  Undo2Icon,
  WalletIcon,
} from "lucide-react";
import Link from "next/link";
import { useState, type ComponentType } from "react";

import { PageHeader } from "@/components/common/page-header";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/use-auth";
import type { BookingScope, BookingSummary } from "@/lib/api/booking-types";
import { bookingsApi } from "@/lib/api/endpoints";
import { queryKeys } from "@/lib/api/query-keys";
import { formatClock, formatTripDate } from "@/lib/datetime";
import { formatCurrency, formatDate, initials } from "@/lib/format";

import { BookingList } from "./booking-list";

type Tab = BookingScope | "all";

const TABS: { value: Tab; label: string; short: string }[] = [
  { value: "upcoming", label: "Upcoming trips", short: "Upcoming" },
  { value: "past", label: "Previous trips", short: "Previous" },
  { value: "cancelled", label: "Cancelled", short: "Cancelled" },
  { value: "all", label: "Booking history", short: "History" },
];

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <dt className="text-sm text-muted-foreground">{label}</dt>
          <dd className="font-heading text-xl font-bold tabular-nums">{value}</dd>
          {hint && <dd className="truncate text-xs text-muted-foreground">{hint}</dd>}
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryCards({ summary }: { summary: BookingSummary | undefined }) {
  if (!summary) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-busy>
        {[0, 1, 2, 3].map((card) => (
          <Skeleton key={card} className="h-20 rounded-2xl" />
        ))}
      </div>
    );
  }
  const next = summary.next_departure;
  return (
    <dl role="group" aria-label="Booking summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        icon={CalendarCheckIcon}
        label="Upcoming trips"
        value={String(summary.upcoming)}
        hint={next ? `Next: ${formatTripDate(next)}, ${formatClock(next)}` : "Nothing booked yet"}
      />
      <StatCard icon={HistoryIcon} label="Previous trips" value={String(summary.past)} />
      <StatCard icon={BanIcon} label="Cancelled" value={String(summary.cancelled)} />
      <StatCard
        icon={summary.open_refunds > 0 ? Undo2Icon : WalletIcon}
        label="Total paid"
        value={formatCurrency(summary.spent, summary.currency)}
        hint={
          summary.open_refunds > 0
            ? `${summary.open_refunds} refund${summary.open_refunds === 1 ? "" : "s"} on the way`
            : undefined
        }
      />
    </dl>
  );
}

/** The customer dashboard: who you are, what you have spent, and every booking you have made. */
export function AccountOverview() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("upcoming");
  const [page, setPage] = useState(1);
  const summary = useQuery({
    queryKey: queryKeys.bookingSummary,
    queryFn: ({ signal }) => bookingsApi.summary(signal),
  });

  if (!user) return null;

  return (
    <div className="space-y-8">
      <PageHeader
        title={`Ayubowan, ${user.name.split(" ")[0]}!`}
        description="Your trips, tickets and account details in one place."
        actions={
          <Button asChild variant="cta" size="xl">
            <Link href="/#search">Book a trip</Link>
          </Button>
        }
      />

      <SummaryCards summary={summary.data} />

      <div className="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-sm text-muted-foreground">Profile</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href="/account/profile">
                <PencilIcon data-icon="inline-start" />
                Edit
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center gap-3">
              <Avatar size="lg">
                <AvatarFallback className="bg-primary font-semibold text-primary-foreground">
                  {initials(user.name)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate font-semibold">{user.name}</p>
                <p className="text-xs text-muted-foreground">
                  Member since {formatDate(user.created_at)}
                </p>
              </div>
            </div>
            <dl className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <dt>
                  <MailIcon className="size-4 text-muted-foreground" aria-label="Email" />
                </dt>
                <dd className="truncate">{user.email}</dd>
              </div>
              <div className="flex items-center gap-2">
                <dt>
                  <PhoneIcon className="size-4 text-muted-foreground" aria-label="Phone" />
                </dt>
                <dd>{user.phone || "Not provided"}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <section aria-labelledby="bookings-heading" className="min-w-0 space-y-4">
          <h2 id="bookings-heading" className="text-lg font-bold">
            My bookings
          </h2>
          <Tabs
            value={tab}
            onValueChange={(value) => {
              setTab(value as Tab);
              setPage(1);
            }}
          >
            <TabsList className="h-auto w-full flex-wrap justify-start sm:w-fit">
              {TABS.map((entry) => (
                <TabsTrigger
                  key={entry.value}
                  value={entry.value}
                  aria-label={entry.label}
                  className="flex-none px-3 py-1.5"
                >
                  {/* Short labels on phones, the full wording from sm up. */}
                  <span className="sm:hidden">{entry.short}</span>
                  <span className="hidden sm:inline">{entry.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
            {TABS.map((entry) => (
              <TabsContent key={entry.value} value={entry.value} className="mt-4">
                {tab === entry.value && (
                  <BookingList scope={entry.value} page={page} onPageChange={setPage} />
                )}
              </TabsContent>
            ))}
          </Tabs>
        </section>
      </div>
    </div>
  );
}
