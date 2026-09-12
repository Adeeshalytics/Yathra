/**
 * Booking-flow rules for the browser. They only decide what to ask the server; the server
 * decides what actually happens (locks, prices, availability).
 */
import type { BookingStatus, PassengerInput } from "@/lib/api/booking-types";
import { ApiError } from "@/lib/api/errors";
import type { SeatHold, TripSeat } from "@/lib/api/trip-types";

export type SeatAction =
  | { kind: "lock" }
  | { kind: "release"; lockId: string }
  | { kind: "swap"; releaseLockId: string }
  | { kind: "limit" }
  | { kind: "sign-in" }
  | { kind: "unavailable" };

/**
 * What tapping a seat should do. Your own seats are released; free seats are locked while you
 * need more; with one passenger a new seat replaces the old one; otherwise you must free one.
 */
export function seatAction(
  seat: TripSeat,
  hold: SeatHold | null,
  target: number,
  signedIn: boolean,
): SeatAction {
  const held = hold?.seats ?? [];
  const mine = held.find((lock) => lock.seat_number === seat.seat_number);
  if (seat.locked_by_me && mine) return { kind: "release", lockId: mine.id };
  if (seat.status !== "available") return { kind: "unavailable" };
  if (!signedIn) return { kind: "sign-in" };
  if (held.length < target) return { kind: "lock" };
  if (target === 1 && held.length === 1) return { kind: "swap", releaseLockId: held[0].id };
  return { kind: "limit" };
}

export const UNPAID_STATUSES: readonly BookingStatus[] = ["pending", "payment_pending"];

export function isUnpaid(status: BookingStatus): boolean {
  return UNPAID_STATUSES.includes(status);
}

const PASSENGER_FIELDS = ["seat_number", "name", "phone", "email"] as const satisfies readonly (keyof PassengerInput)[];

export interface PassengerFieldError {
  index: number;
  field: (typeof PASSENGER_FIELDS)[number];
  message: string;
}

/** Per-passenger messages from a 400 response: `{"passengers": [{}, {"phone": ["…"]}]}`. */
export function passengerFieldErrors(error: unknown): PassengerFieldError[] {
  if (!(error instanceof ApiError) || !error.details) return [];
  const list = error.details.passengers;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    return PASSENGER_FIELDS.flatMap((field) => {
      const messages = (item as Record<string, unknown>)[field];
      const first = Array.isArray(messages) ? messages[0] : messages;
      return typeof first === "string" ? [{ index, field, message: first }] : [];
    });
  });
}
