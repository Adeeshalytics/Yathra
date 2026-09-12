/**
 * Seat-layout helpers shared by the admin editor and (later) the customer seat picker.
 * The rules mirror apps/fleet/seat_layouts.py; the API remains the source of truth.
 */
import type { Seat, SeatType } from "@/lib/api/admin-types";

export const MAX_LAYOUT_ROWS = 25;
export const MIN_LAYOUT_COLUMNS = 2;
export const MAX_LAYOUT_COLUMNS = 7;
export const MAX_CONDUCTOR_SEATS = 2;
export const SEAT_NUMBER_PATTERN = /^[A-Z0-9-]{1,8}$/;

export const PASSENGER_SEAT_TYPES: readonly SeatType[] = ["normal", "window", "aisle", "reserved"];
export const BOOKABLE_SEAT_TYPES: readonly SeatType[] = ["normal", "window", "aisle"];
export const CREW_SEAT_TYPES: readonly SeatType[] = ["driver", "conductor"];

export const SEAT_TYPE_OPTIONS: { value: SeatType; label: string; description: string }[] = [
  { value: "window", label: "Window", description: "Passenger seat by the window" },
  { value: "aisle", label: "Aisle", description: "Passenger seat next to the aisle" },
  { value: "normal", label: "Normal", description: "Other passenger seat (e.g. back row)" },
  { value: "reserved", label: "Reserved", description: "Kept for clergy / priority, not sold online" },
  { value: "driver", label: "Driver", description: "Exactly one per layout, never sold" },
  { value: "conductor", label: "Conductor", description: "Crew seat, never sold" },
];

export function isCrew(type: SeatType): boolean {
  return CREW_SEAT_TYPES.includes(type);
}

export function isBookable(seat: Seat): boolean {
  return seat.is_available && BOOKABLE_SEAT_TYPES.includes(seat.seat_type);
}

export function countSeats(seats: readonly Seat[]) {
  const passenger = seats.filter((seat) => PASSENGER_SEAT_TYPES.includes(seat.seat_type));
  return {
    seatCount: passenger.length,
    bookableCount: seats.filter(isBookable).length,
    unavailableCount: passenger.filter((seat) => !seat.is_available).length,
    reservedCount: seats.filter((seat) => seat.seat_type === "reserved").length,
  };
}

export function findSeat(seats: readonly Seat[], row: number, column: number): Seat | undefined {
  return seats.find((seat) => seat.row === row && seat.column === column);
}

/** Every problem with a layout, as readable messages (empty = valid). */
export function validateSeats(rows: number, columns: number, seats: readonly Seat[]): string[] {
  const errors: string[] = [];
  const positions = new Map<string, string>();
  const numbers = new Map<string, number>();
  let drivers = 0;
  let conductors = 0;
  let passengers = 0;

  if (rows < 1 || rows > MAX_LAYOUT_ROWS) errors.push(`Use between 1 and ${MAX_LAYOUT_ROWS} rows.`);
  if (columns < MIN_LAYOUT_COLUMNS || columns > MAX_LAYOUT_COLUMNS) {
    errors.push(`Use between ${MIN_LAYOUT_COLUMNS} and ${MAX_LAYOUT_COLUMNS} columns.`);
  }

  for (const seat of seats) {
    const label = seat.seat_number || "(unnumbered)";
    if (seat.row < 1 || seat.row > rows || seat.column < 1 || seat.column > columns) {
      errors.push(`Seat ${label} is outside the ${rows} × ${columns} grid.`);
    }
    const key = `${seat.row}:${seat.column}`;
    const other = positions.get(key);
    if (other !== undefined) {
      errors.push(`Seats ${other} and ${label} share row ${seat.row}, column ${seat.column}.`);
    } else {
      positions.set(key, label);
    }
    if (!SEAT_NUMBER_PATTERN.test(seat.seat_number)) {
      errors.push(`Seat number “${seat.seat_number}” must be 1–8 letters, digits or dashes.`);
    }
    const number = seat.seat_number.toUpperCase();
    numbers.set(number, (numbers.get(number) ?? 0) + 1);
    if (seat.seat_type === "driver") drivers += 1;
    else if (seat.seat_type === "conductor") conductors += 1;
    else passengers += 1;
  }

  for (const [number, count] of numbers) {
    if (count > 1) errors.push(`Seat number ${number} is used ${count} times.`);
  }
  if (drivers !== 1) errors.push("A layout needs exactly one driver seat.");
  if (conductors > MAX_CONDUCTOR_SEATS) {
    errors.push(`A layout can have at most ${MAX_CONDUCTOR_SEATS} conductor seats.`);
  }
  if (passengers === 0) errors.push("Add at least one passenger seat.");
  return errors;
}

/**
 * Number passenger seats 1..N front-to-back, left-to-right. Crew seats get D / C / C2.
 */
export function renumberSeats(seats: readonly Seat[]): Seat[] {
  const ordered = [...seats].sort((a, b) => a.row - b.row || a.column - b.column);
  let passenger = 0;
  let conductor = 0;
  return ordered.map((seat) => {
    if (seat.seat_type === "driver") return { ...seat, seat_number: "D" };
    if (seat.seat_type === "conductor") {
      conductor += 1;
      return { ...seat, seat_number: conductor === 1 ? "C" : `C${conductor}` };
    }
    passenger += 1;
    return { ...seat, seat_number: String(passenger) };
  });
}

/** The smallest unused positive seat number, as a string. */
export function nextSeatNumber(seats: readonly Seat[]): string {
  const used = new Set(seats.map((seat) => seat.seat_number.toUpperCase()));
  let candidate = 1;
  while (used.has(String(candidate))) candidate += 1;
  return String(candidate);
}

export type SeatTool = SeatType | "erase" | "toggle-availability";

/** Apply an editor tool to one grid cell and return the new seat list. */
export function applyTool(
  seats: readonly Seat[],
  row: number,
  column: number,
  tool: SeatTool,
): Seat[] {
  const existing = findSeat(seats, row, column);
  const others = seats.filter((seat) => seat !== existing);

  if (tool === "erase") return others;
  if (tool === "toggle-availability") {
    if (!existing || isCrew(existing.seat_type)) return [...seats];
    return seats.map((seat) =>
      seat === existing ? { ...seat, is_available: !seat.is_available } : seat,
    );
  }

  const crew = isCrew(tool);
  if (existing) {
    const seatNumber =
      tool === "driver" ? "D" : isCrew(existing.seat_type) ? nextSeatNumber(others) : existing.seat_number;
    return seats.map((seat) =>
      seat === existing
        ? { ...seat, seat_type: tool, seat_number: seatNumber, is_available: crew ? false : seat.is_available }
        : seat,
    );
  }
  const seatNumber = tool === "driver" ? "D" : tool === "conductor" ? "C" : nextSeatNumber(seats);
  return [
    ...seats,
    { seat_number: seatNumber, row, column, seat_type: tool, is_available: !crew },
  ];
}

/** Seats that would fall outside a smaller grid. */
export function seatsOutside(seats: readonly Seat[], rows: number, columns: number): Seat[] {
  return seats.filter((seat) => seat.row > rows || seat.column > columns);
}
