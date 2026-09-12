/**
 * Choosing where to get on and off on a trip page. Pure helpers so the rules are easy to test;
 * the booking API re-validates everything.
 */
import type { StopTime, TripSeat } from "@/lib/api/trip-types";

/** Drop-off points reachable from a boarding point: every one further along the route. */
export function dropoffsAfter(dropoffs: readonly StopTime[], boarding: StopTime | null): StopTime[] {
  return boarding ? dropoffs.filter((point) => point.sequence > boarding.sequence) : [];
}

/** Boarding points from which at least one drop-off can still be reached. */
export function usableBoardings(
  boardings: readonly StopTime[],
  dropoffs: readonly StopTime[],
): StopTime[] {
  return boardings.filter((point) => dropoffs.some((dropoff) => dropoff.sequence > point.sequence));
}

const sameCity = (point: StopTime, city?: string) =>
  Boolean(city) && point.stop.city.toLowerCase() === city?.toLowerCase();

/**
 * The boarding and drop-off to show first: the customer's own choice when still valid, else
 * the first stop in the searched cities, else the route's first boarding / last drop-off.
 */
export function resolveSegment({
  boardings,
  dropoffs,
  boardingId,
  dropoffId,
  fromCity,
  toCity,
}: {
  boardings: readonly StopTime[];
  dropoffs: readonly StopTime[];
  boardingId?: string | null;
  dropoffId?: string | null;
  fromCity?: string;
  toCity?: string;
}): { boarding: StopTime | null; dropoff: StopTime | null; dropoffOptions: StopTime[] } {
  const options = usableBoardings(boardings, dropoffs);
  const boarding =
    options.find((point) => point.stop.id === boardingId) ??
    options.find((point) => sameCity(point, fromCity)) ??
    options[0] ??
    null;
  const dropoffOptions = dropoffsAfter(dropoffs, boarding);
  const dropoff =
    dropoffOptions.find((point) => point.stop.id === dropoffId) ??
    dropoffOptions.find((point) => sameCity(point, toCity)) ??
    dropoffOptions.at(-1) ??
    null;
  return { boarding, dropoff, dropoffOptions };
}

/** Seat numbers in bus order (front to back, left to right) for display. */
export function sortSeatNumbers(numbers: readonly string[], seats: readonly TripSeat[]): string[] {
  const position = new Map(seats.map((seat) => [seat.seat_number, seat.row * 100 + seat.column]));
  return [...numbers].sort((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0));
}
