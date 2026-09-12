"use client";

import type { Seat, SeatType } from "@/lib/api/admin-types";
import { countSeats, isCrew } from "@/lib/seat-layout";
import { cn } from "@/lib/utils";

export function seatKey(row: number, column: number): string {
  return `${row}:${column}`;
}

const TYPE_STYLES: Record<SeatType, string> = {
  window: "border-primary/60 bg-primary/15 text-primary",
  aisle: "border-primary/40 bg-primary/5 text-primary",
  normal: "border-primary/30 bg-card text-foreground",
  reserved: "border-amber-400 bg-amber-100 text-amber-900",
  driver: "border-foreground bg-foreground text-background",
  conductor: "border-slate-400 bg-slate-200 text-slate-800",
};

const TYPE_LABEL: Record<SeatType, string> = {
  window: "window",
  aisle: "aisle",
  normal: "standard",
  reserved: "reserved",
  driver: "driver",
  conductor: "conductor",
};

const UNAVAILABLE_STYLE =
  "border-dashed border-muted-foreground/50 bg-[repeating-linear-gradient(135deg,var(--muted),var(--muted)_4px,transparent_4px,transparent_8px)] text-muted-foreground line-through";

const CELL_BASE =
  "flex size-10 items-center justify-center rounded-lg border text-xs font-semibold tabular-nums transition-colors";

function describe(seat: Seat): string {
  const state = isCrew(seat.seat_type) ? "" : seat.is_available ? ", available" : ", blocked";
  return `Seat ${seat.seat_number}, ${TYPE_LABEL[seat.seat_type]}, row ${seat.row} column ${seat.column}${state}`;
}

function seatStyle(seat: Seat): string {
  return cn(TYPE_STYLES[seat.seat_type], !seat.is_available && !isCrew(seat.seat_type) && UNAVAILABLE_STYLE);
}

interface SeatMapProps {
  rows: number;
  columns: number;
  seats: readonly Seat[];
  /** "edit" renders every cell as a button (empty cells too). */
  mode?: "view" | "edit";
  selectedKey?: string | null;
  onCellClick?: (row: number, column: number, seat: Seat | undefined) => void;
  label?: string;
  className?: string;
}

/**
 * A bus seat map drawn from a stored layout. Used by the admin editor and read-only
 * previews, and designed to be reused by the customer seat picker.
 */
export function SeatMap({
  rows,
  columns,
  seats,
  mode = "view",
  selectedKey = null,
  onCellClick,
  label = "Seat map",
  className,
}: SeatMapProps) {
  const byKey = new Map(seats.map((seat) => [seatKey(seat.row, seat.column), seat]));
  const { seatCount, bookableCount } = countSeats(seats);
  const positions = Array.from({ length: rows * columns }, (_, index) => ({
    row: Math.floor(index / columns) + 1,
    column: (index % columns) + 1,
  }));

  const cells = positions.map(({ row, column }) => {
    const key = seatKey(row, column);
    const seat = byKey.get(key);

    if (mode === "view") {
      return seat ? (
        <div key={key} title={describe(seat)} className={cn(CELL_BASE, seatStyle(seat))}>
          {seat.seat_number}
        </div>
      ) : (
        <div key={key} className="size-10" />
      );
    }

    return (
      <button
        key={key}
        type="button"
        onClick={() => onCellClick?.(row, column, seat)}
        aria-label={seat ? describe(seat) : `Empty cell, row ${row} column ${column}`}
        aria-pressed={selectedKey === key}
        className={cn(
          CELL_BASE,
          "outline-none focus-visible:ring-3 focus-visible:ring-ring/60",
          seat
            ? [seatStyle(seat), "hover:brightness-95"]
            : "border-dashed border-border text-muted-foreground/40 hover:border-primary hover:bg-primary/5 hover:text-primary",
          selectedKey === key && "ring-3 ring-ring ring-offset-1",
        )}
      >
        {seat ? seat.seat_number : "+"}
      </button>
    );
  });

  return (
    <div
      className={cn(
        "inline-block rounded-[1.75rem] border-2 border-foreground/15 bg-card p-3 shadow-sm sm:p-4",
        className,
      )}
    >
      <div className="mb-3 flex items-center justify-between px-1 text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
        <span>Door</span>
        <span>Front</span>
      </div>
      <div
        role={mode === "view" ? "img" : "group"}
        aria-label={
          mode === "view"
            ? `${label}: ${seatCount} passenger seats, ${bookableCount} bookable, in ${rows} rows`
            : label
        }
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${columns}, 2.5rem)` }}
      >
        {cells}
      </div>
      <div className="mt-3 text-center text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
        Rear
      </div>
    </div>
  );
}

const LEGEND: { label: string; className: string }[] = [
  { label: "Window", className: TYPE_STYLES.window },
  { label: "Aisle", className: TYPE_STYLES.aisle },
  { label: "Standard", className: TYPE_STYLES.normal },
  { label: "Reserved", className: TYPE_STYLES.reserved },
  { label: "Driver", className: TYPE_STYLES.driver },
  { label: "Conductor", className: TYPE_STYLES.conductor },
  { label: "Blocked", className: UNAVAILABLE_STYLE },
];

export function SeatLegend({ className }: { className?: string }) {
  return (
    <ul className={cn("flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground", className)}>
      {LEGEND.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span aria-hidden className={cn("size-4 rounded border", item.className)} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
