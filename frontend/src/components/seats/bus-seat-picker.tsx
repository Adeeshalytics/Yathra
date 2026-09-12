"use client";

import { ClockIcon, DoorOpenIcon, UserRoundIcon } from "lucide-react";
import type { ReactNode, SVGProps } from "react";

import type { SeatType } from "@/lib/api/admin-types";
import type { TripSeat, TripSeatMap } from "@/lib/api/trip-types";
import { cn } from "@/lib/utils";

function SteeringWheel(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" {...props}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M12 14.5V21M9.7 11.1 3.4 9.4M14.3 11.1l6.3-1.7" />
    </svg>
  );
}

const SEAT_KIND: Partial<Record<SeatType, string>> = {
  window: "window seat",
  aisle: "aisle seat",
  normal: "seat",
  reserved: "reserved seat",
};

/** How a seat looks: the server's status, with your own locks shown as "selected". */
type SeatLook = "available" | "selected" | "locked" | "booked" | "blocked";

export function seatLook(seat: TripSeat): SeatLook {
  return seat.locked_by_me ? "selected" : seat.status;
}

const LOOKS: Record<SeatLook, string> = {
  available:
    "border-emerald-500/70 bg-white text-emerald-900 hover:-translate-y-0.5 hover:bg-emerald-50 hover:shadow-sm dark:bg-emerald-950/30 dark:text-emerald-100",
  selected: "border-primary bg-primary text-primary-foreground shadow-md ring-2 ring-primary/30",
  locked: "border-amber-400 bg-amber-100 text-amber-800",
  booked: "border-rose-500 bg-rose-500 text-white",
  blocked:
    "border-dashed border-slate-300 bg-[repeating-linear-gradient(135deg,var(--muted),var(--muted)_3px,transparent_3px,transparent_7px)] text-slate-400",
};

const STATUS_WORD: Record<SeatLook, string> = {
  available: "available",
  selected: "your seat",
  locked: "held by another passenger",
  booked: "booked",
  blocked: "not available",
};

/** One seat seen from above: the backrest is the bar at the rear (bottom) edge. */
function SeatShape({ look, pending, children }: { look: SeatLook; pending: boolean; children: ReactNode }) {
  return (
    <span
      className={cn(
        "relative flex size-10 items-start justify-center rounded-t-xl rounded-b-md border-2 pt-1 text-[11px] font-bold tabular-nums transition-all",
        LOOKS[look],
        pending && "animate-pulse",
      )}
    >
      {children}
      <span aria-hidden className="absolute inset-x-1 bottom-0.5 h-1.5 rounded-sm bg-current opacity-30" />
    </span>
  );
}

/**
 * The inside of the bus seen from above, front at the top: the driver sits on the right, the
 * door is at the front left. Seat states come from the server for this trip.
 */
export function BusSeatPicker({
  map,
  onToggle,
  pendingSeat = null,
  disabled = false,
  className,
}: {
  map: TripSeatMap;
  onToggle: (seat: TripSeat) => void;
  /** A seat whose lock / release request is in flight. */
  pendingSeat?: string | null;
  disabled?: boolean;
  className?: string;
}) {
  const { rows, columns } = map.layout;
  const byPosition = new Map(map.seats.map((seat) => [`${seat.row}:${seat.column}`, seat]));

  const cells = Array.from({ length: rows * columns }, (_, index) => {
    const row = Math.floor(index / columns) + 1;
    const column = (index % columns) + 1;
    const key = `${row}:${column}`;
    const seat = byPosition.get(key);

    if (!seat) return <div key={key} className="size-10" aria-hidden />;

    if (seat.seat_type === "driver") {
      return (
        <div
          key={key}
          role="img"
          aria-label="Driver"
          className="grid size-10 place-items-center rounded-full border-2 border-slate-400 bg-slate-100 text-slate-600"
        >
          <SteeringWheel className="size-6" />
        </div>
      );
    }
    if (seat.seat_type === "conductor") {
      return (
        <div
          key={key}
          role="img"
          aria-label="Conductor seat"
          className="grid size-10 place-items-center rounded-lg border border-slate-300 bg-slate-100 text-[10px] font-semibold text-slate-500"
        >
          C
        </div>
      );
    }

    const look = seatLook(seat);
    const pending = pendingSeat === seat.seat_number;
    const selectable = look === "available" || look === "selected";
    return (
      <button
        key={key}
        type="button"
        onClick={() => onToggle(seat)}
        disabled={disabled || !selectable || (pendingSeat !== null && !pending)}
        aria-pressed={look === "selected"}
        aria-busy={pending || undefined}
        aria-label={`Seat ${seat.seat_number}, ${SEAT_KIND[seat.seat_type] ?? "seat"}, ${STATUS_WORD[look]}`}
        title={`Seat ${seat.seat_number} · ${STATUS_WORD[look]}`}
        className="rounded-t-xl rounded-b-md outline-none focus-visible:ring-3 focus-visible:ring-ring/60 disabled:cursor-not-allowed"
      >
        <SeatShape look={look} pending={pending}>
          {look === "booked" ? (
            <UserRoundIcon className="size-4" aria-hidden />
          ) : look === "locked" ? (
            <ClockIcon className="size-4" aria-hidden />
          ) : (
            seat.seat_number
          )}
        </SeatShape>
      </button>
    );
  });

  return (
    <div className={cn("inline-block", className)}>
      <div className="relative rounded-t-[3rem] rounded-b-3xl border-[3px] border-slate-300 bg-slate-50 px-3 pt-3 pb-5 shadow-inner sm:px-4 dark:border-slate-600 dark:bg-slate-900/60">
        <span aria-hidden className="absolute top-12 -left-2.5 h-7 w-2 rounded-full bg-slate-300 dark:bg-slate-600" />
        <span aria-hidden className="absolute top-12 -right-2.5 h-7 w-2 rounded-full bg-slate-300 dark:bg-slate-600" />
        <div aria-hidden className="mx-4 mb-2 h-2.5 rounded-t-full bg-sky-200/80 dark:bg-sky-900/60" />
        <div className="mb-2 flex items-center justify-between px-0.5 text-[10px] font-semibold tracking-widest text-slate-500 uppercase">
          <span className="flex items-center gap-1">
            <DoorOpenIcon className="size-3.5" aria-hidden />
            Door
          </span>
          <span>Front</span>
        </div>
        <div
          role="group"
          aria-label="Seats, front of the bus at the top"
          className="grid gap-1.5"
          style={{ gridTemplateColumns: `repeat(${columns}, 2.5rem)` }}
        >
          {cells}
        </div>
        <div className="mt-3 text-center text-[10px] font-semibold tracking-widest text-slate-500 uppercase">
          Rear
        </div>
      </div>
    </div>
  );
}

const LEGEND: { look: SeatLook; label: string }[] = [
  { look: "available", label: "Available" },
  { look: "selected", label: "Your seats" },
  { look: "locked", label: "Being booked" },
  { look: "booked", label: "Booked" },
  { look: "blocked", label: "Not for sale" },
];

export function SeatPickerLegend({ className }: { className?: string }) {
  return (
    <ul className={cn("flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground", className)}>
      {LEGEND.map((item) => (
        <li key={item.look} className="flex items-center gap-2">
          <span aria-hidden className={cn("size-4 rounded-t-md rounded-b-sm border-2", LOOKS[item.look])} />
          {item.label}
        </li>
      ))}
      <li className="flex items-center gap-2">
        <SteeringWheel className="size-4 text-slate-500" aria-hidden />
        Driver
      </li>
    </ul>
  );
}
