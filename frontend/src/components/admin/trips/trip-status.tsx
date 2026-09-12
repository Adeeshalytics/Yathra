import { StatusBadge } from "@/components/common/status-badge";
import { Badge } from "@/components/ui/badge";
import type { AdminTrip, TripStatus } from "@/lib/api/admin-types";
import { TRIP_STATUSES } from "@/lib/validations/trips";

export const TRIP_STATUS_LABEL = Object.fromEntries(
  TRIP_STATUSES.map((status) => [status.value, status.label]),
) as Record<TripStatus, string>;

/** Button / menu wording for moving a trip *to* a status. */
export const STATUS_ACTION_LABEL: Record<TripStatus, string> = {
  scheduled: "Back to scheduled",
  boarding: "Start boarding",
  departed: "Mark departed",
  completed: "Mark completed",
  cancelled: "Cancel trip",
};

export const STATUS_HELP: Record<TripStatus, string> = {
  scheduled: "The trip returns to the timetable and can be edited again.",
  boarding: "Passengers are boarding. The trip can’t be edited while it is boarding.",
  departed: "The bus has left the origin. This can only move on to completed.",
  completed: "The journey is over. This can’t be undone.",
  cancelled: "The trip is cancelled.",
};

/** Trips that haven't left yet. */
export function isOpenTrip(trip: Pick<AdminTrip, "status">): boolean {
  return trip.status === "scheduled" || trip.status === "boarding";
}

export function TripStatusBadge({ status }: { status: TripStatus }) {
  return <StatusBadge status={status} />;
}

/** Shown for open trips that are hidden from sale. */
export function SaleBadge({ trip }: { trip: Pick<AdminTrip, "status" | "active"> }) {
  if (trip.active || !isOpenTrip(trip)) return null;
  return (
    <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-900">
      Off sale
    </Badge>
  );
}
