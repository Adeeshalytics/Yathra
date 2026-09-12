"use client";

import {
  ArrowRightLeftIcon,
  BanIcon,
  CalendarPlusIcon,
  CirclePlusIcon,
  HistoryIcon,
  PencilIcon,
  PowerIcon,
  PowerOffIcon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react";
import Link from "next/link";
import type { ComponentType } from "react";

import { TRIP_STATUS_LABEL } from "@/components/admin/trips/trip-status";
import { EmptyState } from "@/components/common/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import type { ActivityAction, ActivityEntry, TripStatus } from "@/lib/api/admin-types";
import { formatDay } from "@/lib/datetime";
import { formatCurrency, formatDateTime, formatRelativeTime, pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";

const ENTITIES: Record<string, { noun: string; href?: (id: string) => string }> = {
  operator: { noun: "operator", href: (id) => `/admin/operators/${id}` },
  bus: { noun: "bus", href: (id) => `/admin/buses/${id}` },
  seatlayout: { noun: "seat layout", href: (id) => `/admin/seat-layouts/${id}` },
  route: { noun: "route", href: (id) => `/admin/routes/${id}` },
  stop: { noun: "stop", href: () => "/admin/stops" },
  trip: { noun: "trip", href: (id) => `/admin/trips/${id}` },
  tripschedule: { noun: "schedule", href: (id) => `/admin/schedules/${id}` },
  payment: { noun: "payment", href: (id) => `/admin/payments/${id}` },
};

const ACTIONS: Record<
  ActivityAction,
  { verb: string; icon: ComponentType<{ className?: string }>; tone: string }
> = {
  created: { verb: "created", icon: CirclePlusIcon, tone: "bg-emerald-50 text-emerald-700" },
  updated: { verb: "updated", icon: PencilIcon, tone: "bg-secondary text-primary" },
  deleted: { verb: "deleted", icon: Trash2Icon, tone: "bg-red-50 text-red-700" },
  activated: { verb: "activated", icon: PowerIcon, tone: "bg-emerald-50 text-emerald-700" },
  deactivated: { verb: "deactivated", icon: PowerOffIcon, tone: "bg-amber-50 text-amber-800" },
  cancelled: { verb: "cancelled", icon: BanIcon, tone: "bg-red-50 text-red-700" },
  status_changed: {
    verb: "changed the status of",
    icon: ArrowRightLeftIcon,
    tone: "bg-secondary text-primary",
  },
  generated: { verb: "generated trips from", icon: CalendarPlusIcon, tone: "bg-emerald-50 text-emerald-700" },
  refunded: { verb: "refunded", icon: Undo2Icon, tone: "bg-amber-50 text-amber-800" },
};

function humanizeField(field: string): string {
  return field.replace(/_/g, " ");
}

function statusLabel(status: string): string {
  return TRIP_STATUS_LABEL[status as TripStatus] ?? status;
}

/** One-line summary of what changed, if the entry carries one. */
function describeChanges(entry: ActivityEntry): string | null {
  const { changes } = entry;
  if (entry.action === "status_changed" && changes.from && changes.to) {
    return `${statusLabel(changes.from)} → ${statusLabel(changes.to)}`;
  }
  if (entry.action === "generated" && changes.created !== undefined) {
    const range =
      changes.from_date && changes.to_date
        ? ` · ${formatDay(changes.from_date, { year: false })} – ${formatDay(changes.to_date, { year: false })}`
        : "";
    return `${pluralize(changes.created, "trip")}${range}`;
  }
  if (entry.action === "cancelled" && changes.reason) return `Reason: ${changes.reason}`;
  if (entry.action === "refunded" && changes.amount) {
    return `${formatCurrency(changes.amount)} refunded in total${changes.reason ? ` · ${changes.reason}` : ""}`;
  }
  const fields = changes.fields ?? [];
  return fields.length > 0 ? `Changed ${fields.map(humanizeField).join(", ")}` : null;
}

export function ActivityFeed({
  entries,
  isLoading,
}: {
  entries: ActivityEntry[] | undefined;
  isLoading: boolean;
}) {
  if (isLoading || !entries) {
    return (
      <ul className="space-y-4" aria-busy>
        {Array.from({ length: 5 }, (_, index) => (
          <li key={index} className="flex gap-3">
            <Skeleton className="size-9 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-24" />
            </div>
          </li>
        ))}
      </ul>
    );
  }

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={HistoryIcon}
        title="No activity yet"
        description="Changes to operators, buses, layouts, routes, stops and trips will appear here."
        className="border-none bg-transparent py-6"
      />
    );
  }

  return (
    <ol className="space-y-4">
      {entries.map((entry) => {
        const action = ACTIONS[entry.action] ?? ACTIONS.updated;
        const entity = ENTITIES[entry.entity_type] ?? { noun: entry.entity_type };
        const Icon = action.icon;
        const href = entry.action !== "deleted" ? entity.href?.(entry.entity_id) : undefined;
        const detail = describeChanges(entry);
        return (
          <li key={entry.id} className="flex gap-3">
            <span
              aria-hidden
              className={cn("grid size-9 shrink-0 place-items-center rounded-full", action.tone)}
            >
              <Icon className="size-4" />
            </span>
            <div className="min-w-0 text-sm">
              <p className="leading-snug">
                <span className="font-medium">{entry.actor_email || "System"}</span>{" "}
                {action.verb} {entity.noun}{" "}
                {href ? (
                  <Link href={href} className="font-medium text-primary hover:underline">
                    {entry.entity_label}
                  </Link>
                ) : (
                  <span className="font-medium">{entry.entity_label}</span>
                )}
              </p>
              {detail && <p className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</p>}
              <time
                dateTime={entry.created_at}
                title={formatDateTime(entry.created_at)}
                className="mt-0.5 block text-xs text-muted-foreground"
              >
                {formatRelativeTime(entry.created_at)}
              </time>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
