import { cn } from "@/lib/utils";

export const TRIP_STATUS_OPTIONS = [
  { value: "scheduled", label: "Scheduled" },
  { value: "boarding", label: "Boarding" },
  { value: "departed", label: "Departed" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

/** Seats sold against capacity, as a number and a bar. */
export function SeatsSold({
  sold,
  capacity,
  className,
}: {
  sold: number;
  capacity: number;
  className?: string;
}) {
  const percent = capacity ? Math.min(100, Math.round((sold / capacity) * 100)) : 0;
  return (
    <div className={cn("min-w-28 space-y-1", className)}>
      <p className="text-sm tabular-nums">
        <span className="font-semibold">{sold}</span>
        <span className="text-muted-foreground"> / {capacity} seats</span>
      </p>
      <div
        role="meter"
        aria-label="Seats sold"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent}% sold`}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn("h-full rounded-full", percent >= 90 ? "bg-emerald-600" : "bg-primary")}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
