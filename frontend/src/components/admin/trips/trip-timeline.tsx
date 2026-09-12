import { Badge } from "@/components/ui/badge";
import type { AdminTripDetail } from "@/lib/api/admin-types";
import { daysBetween, formatTime, minutesBetween, sriLankaParts } from "@/lib/datetime";
import { cn } from "@/lib/utils";

function DayShift({ from, iso }: { from: string; iso: string }) {
  const days = daysBetween(from, sriLankaParts(iso).date);
  if (days <= 0) return null;
  return (
    <Badge variant="secondary" className="ml-1.5">
      +{days} day{days > 1 ? "s" : ""}
    </Badge>
  );
}

/** A trip's own stop timetable, in Sri Lankan clock time. */
export function TripTimeline({ trip }: { trip: AdminTripDetail }) {
  const startDate = sriLankaParts(trip.departure_datetime).date;
  const last = trip.stops.length - 1;
  return (
    <ol aria-label="Stop timings">
      {trip.stops.map((stop, index) => {
        const dwell = minutesBetween(stop.arrival_datetime, stop.departure_datetime);
        const endpoint = index === 0 || index === last;
        return (
          <li key={stop.sequence} className="relative flex gap-4 pb-6 last:pb-0">
            {index < last && (
              <span aria-hidden className="absolute top-9 bottom-1 left-[15px] w-0.5 bg-border" />
            )}
            <span
              className={cn(
                "relative z-10 grid size-8 shrink-0 place-items-center rounded-full border-2 text-xs font-semibold",
                endpoint
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-primary/40 bg-card text-primary",
              )}
            >
              {stop.sequence}
            </span>
            <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">{stop.stop.name}</p>
                <p className="text-xs text-muted-foreground">{stop.stop.city}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {stop.is_boarding_point && <Badge variant="secondary">Boarding</Badge>}
                  {stop.is_dropoff_point && <Badge variant="secondary">Drop-off</Badge>}
                </div>
              </div>
              <div className="text-right text-sm tabular-nums">
                {index === 0 ? (
                  <p className="font-medium">Departs {formatTime(stop.departure_datetime)}</p>
                ) : (
                  <p className="font-medium">
                    Arrives {formatTime(stop.arrival_datetime)}
                    <DayShift from={startDate} iso={stop.arrival_datetime} />
                  </p>
                )}
                {index > 0 && index < last && dwell > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Leaves {formatTime(stop.departure_datetime)} · {dwell} min stop
                  </p>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
