import { Badge } from "@/components/ui/badge";
import type { PublicTripStop } from "@/lib/api/trip-types";
import { dayShift, formatClock } from "@/lib/datetime";
import { cn } from "@/lib/utils";

/** Every stop of the trip with its estimated times; the customer's own journey is highlighted. */
export function TripStopTimeline({
  stops,
  boardingSequence,
  dropoffSequence,
}: {
  stops: readonly PublicTripStop[];
  boardingSequence?: number;
  dropoffSequence?: number;
}) {
  const last = stops.length - 1;
  const start = stops[0]?.departure_datetime;
  const onJourney = (sequence: number) =>
    boardingSequence !== undefined &&
    dropoffSequence !== undefined &&
    sequence >= boardingSequence &&
    sequence <= dropoffSequence;

  return (
    <ol aria-label="All stops">
      {stops.map((stop, index) => {
        const active = onJourney(stop.sequence);
        const isBoarding = stop.sequence === boardingSequence;
        const isDropoff = stop.sequence === dropoffSequence;
        const time = index === 0 ? stop.departure_datetime : stop.arrival_datetime;
        const later = start ? dayShift(start, time) : 0;
        const dwell = index > 0 && index < last && stop.departure_datetime !== stop.arrival_datetime;
        return (
          <li key={stop.sequence} className="relative flex gap-4 pb-5 last:pb-0">
            {index < last && (
              <span
                aria-hidden
                className={cn(
                  "absolute top-7 bottom-0 left-[11px] w-0.5",
                  active && stop.sequence < (dropoffSequence ?? 0) ? "bg-primary" : "bg-border",
                )}
              />
            )}
            <span
              aria-hidden
              className={cn(
                "relative z-10 mt-0.5 size-6 shrink-0 rounded-full border-2",
                isBoarding || isDropoff
                  ? "border-primary bg-primary"
                  : active
                    ? "border-primary bg-card"
                    : "border-border bg-card",
              )}
            />
            <div className={cn("flex min-w-0 flex-1 flex-wrap items-start justify-between gap-2", !active && "text-muted-foreground")}>
              <div className="min-w-0">
                <p className="font-medium">
                  {stop.stop.name}
                  {isBoarding && <Badge className="ml-2">You board</Badge>}
                  {isDropoff && <Badge className="ml-2">You get off</Badge>}
                </p>
                <p className="text-xs">
                  {[stop.is_boarding_point && "Boarding", stop.is_dropoff_point && "Drop-off"]
                    .filter(Boolean)
                    .join(" · ") || "Timing point"}
                </p>
              </div>
              <div className="text-right text-sm tabular-nums">
                <p className="font-medium">
                  {index === 0 ? "Departs" : "Arrives"} {formatClock(time)}
                  {later > 0 && <span className="ml-1 text-xs text-primary">+{later} day</span>}
                </p>
                {dwell && <p className="text-xs">Leaves {formatClock(stop.departure_datetime)}</p>}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
