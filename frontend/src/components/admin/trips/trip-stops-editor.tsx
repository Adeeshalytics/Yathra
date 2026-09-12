"use client";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clockMinutes, clockTime, dayOffset, offsetForClockTime } from "@/lib/datetime";
import { formatOffset } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TripStopRow } from "@/lib/validations/trips";

type TimeField = "arrival" | "departure";

function DayShift({ days }: { days: number }) {
  if (days <= 0) return null;
  return (
    <Badge variant="secondary" className="shrink-0">
      +{days} day{days > 1 ? "s" : ""}
    </Badge>
  );
}

function TimeCell({
  id,
  label,
  stopName,
  departureTime,
  offset,
  error,
  onChange,
}: {
  id: string;
  label: string;
  stopName: string;
  departureTime: string;
  offset: number;
  error?: string;
  onChange: (time: string) => void;
}) {
  const start = clockMinutes(departureTime);
  return (
    <div className="grid gap-1">
      <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
        {label}
        <span className="sr-only"> at {stopName}</span>
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="time"
          className="h-10 w-32 tabular-nums"
          value={start === null ? "" : clockTime(start + offset)}
          disabled={start === null}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => {
            if (event.target.value) onChange(event.target.value);
          }}
        />
        {start !== null && <DayShift days={dayOffset(departureTime, offset)} />}
        {start === null && <span className="text-xs text-muted-foreground tabular-nums">{formatOffset(offset)}</span>}
      </div>
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Per-stop arrival / departure times as Sri Lankan clock times. Rows store minutes after the
 * departure, so a time earlier than the previous stop's rolls over to the next day
 * (20:30 → 00:30 is four hours, not minus twenty).
 */
export function TripStopsEditor({
  rows,
  departureTime,
  onChange,
  errorFor,
}: {
  rows: TripStopRow[];
  /** "HH:MM", or "" while the departure time isn't set yet. */
  departureTime: string;
  onChange: (rows: TripStopRow[]) => void;
  errorFor?: (index: number, field: TimeField) => string | undefined;
}) {
  const last = rows.length - 1;

  function update(index: number, field: TimeField, time: string) {
    const row = rows[index];
    const notBefore = field === "arrival" ? rows[index - 1].departure : row.arrival;
    const offset = offsetForClockTime(time, departureTime, notBefore);
    if (offset === null) return;
    const next =
      field === "arrival"
        ? {
            ...row,
            arrival: offset,
            // Keep the dwell time; the destination simply ends there.
            departure: index === last ? offset : offset + Math.max(row.departure - row.arrival, 0),
          }
        : { ...row, departure: offset };
    onChange(rows.map((candidate, i) => (i === index ? next : candidate)));
  }

  return (
    <ol aria-label="Stop timings" className="divide-y rounded-xl border">
      {rows.map((row, index) => {
        const isOrigin = index === 0;
        const isDestination = index === last;
        return (
          <li
            key={row.sequence}
            className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold",
                  isOrigin || isDestination
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-primary/40 text-primary",
                )}
              >
                {row.sequence}
              </span>
              <div className="min-w-0">
                <p className="truncate font-medium">{row.stop.name}</p>
                <p className="text-xs text-muted-foreground">
                  {isOrigin
                    ? "Origin"
                    : isDestination
                      ? "Destination"
                      : [row.boarding && "Boarding", row.dropoff && "Drop-off"].filter(Boolean).join(" · ") ||
                        "Timing point"}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-start gap-4">
              {isOrigin ? (
                <div className="grid gap-1">
                  <span className="text-xs text-muted-foreground">Departs</span>
                  <span className="flex h-10 items-center font-medium tabular-nums">
                    {departureTime || "—"}
                  </span>
                </div>
              ) : (
                <TimeCell
                  id={`stop-${index}-arrival`}
                  label="Arrives"
                  stopName={row.stop.name}
                  departureTime={departureTime}
                  offset={row.arrival}
                  error={errorFor?.(index, "arrival")}
                  onChange={(time) => update(index, "arrival", time)}
                />
              )}
              {!isOrigin && !isDestination && (
                <TimeCell
                  id={`stop-${index}-departure`}
                  label="Departs"
                  stopName={row.stop.name}
                  departureTime={departureTime}
                  offset={row.departure}
                  error={errorFor?.(index, "departure")}
                  onChange={(time) => update(index, "departure", time)}
                />
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
