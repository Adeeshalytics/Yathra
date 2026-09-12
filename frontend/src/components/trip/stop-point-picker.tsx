import type { StopTime } from "@/lib/api/trip-types";
import { formatClock, formatTripDate } from "@/lib/datetime";
import { cn } from "@/lib/utils";

/** A radio list of boarding (or drop-off) points with their times. */
export function StopPointPicker({
  name,
  legend,
  points,
  value,
  onChange,
  timeLabel,
  emptyText,
}: {
  name: string;
  legend: string;
  points: readonly StopTime[];
  value: string | null;
  onChange: (stopId: string) => void;
  timeLabel: string;
  emptyText: string;
}) {
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="mb-2 text-sm font-semibold">{legend}</legend>
      {points.length === 0 ? (
        <p className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="grid gap-2">
          {points.map((point) => {
            const id = `${name}-${point.stop.id}`;
            const checked = value === point.stop.id;
            return (
              <label
                key={point.stop.id}
                htmlFor={id}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors hover:bg-muted/50",
                  checked && "border-primary bg-primary/5",
                )}
              >
                <input
                  id={id}
                  type="radio"
                  name={name}
                  value={point.stop.id}
                  checked={checked}
                  onChange={() => onChange(point.stop.id)}
                  className="size-4 shrink-0 accent-primary"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{point.stop.name}</span>
                  <span className="block text-xs text-muted-foreground">{point.stop.city}</span>
                </span>
                <span className="shrink-0 text-right text-sm tabular-nums">
                  <span className="block font-medium">{formatClock(point.time)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {timeLabel} · {formatTripDate(point.time, { year: false })}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}
