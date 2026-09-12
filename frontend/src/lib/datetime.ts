/**
 * Sri Lankan wall-clock helpers for timetables. Sri Lanka has no daylight saving, so local
 * time is always UTC+05:30 and these conversions are exact on the server and in any browser.
 */

export const SRI_LANKA_OFFSET = "+05:30";
const OFFSET_MINUTES = 330;
const MINUTE_MS = 60_000;
export const MINUTES_PER_DAY = 24 * 60;

export const WEEKDAYS = [
  { value: 0, short: "Mon", long: "Monday" },
  { value: 1, short: "Tue", long: "Tuesday" },
  { value: 2, short: "Wed", long: "Wednesday" },
  { value: 3, short: "Thu", long: "Thursday" },
  { value: 4, short: "Fri", long: "Friday" },
  { value: 5, short: "Sat", long: "Saturday" },
  { value: 6, short: "Sun", long: "Sunday" },
] as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function localIso(ms: number): string {
  return new Date(ms + OFFSET_MINUTES * MINUTE_MS).toISOString().slice(0, 19);
}

/** Sri Lankan calendar date and 24-hour time of an instant: { date: "2026-09-15", time: "20:30" }. */
export function sriLankaParts(iso: string): { date: string; time: string } {
  const local = localIso(new Date(iso).getTime());
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

/** ISO timestamp for a Sri Lankan date and wall-clock time. */
export function sriLankaDateTime(date: string, time: string): string {
  return `${date}T${time}:00${SRI_LANKA_OFFSET}`;
}

/** `iso` moved by `minutes`, as a Sri Lanka-offset ISO timestamp. */
export function addMinutes(iso: string, minutes: number): string {
  return `${localIso(new Date(iso).getTime() + minutes * MINUTE_MS)}${SRI_LANKA_OFFSET}`;
}

export function minutesBetween(from: string, to: string): number {
  return Math.round((new Date(to).getTime() - new Date(from).getTime()) / MINUTE_MS);
}

/** "20:30" → 1230; null when the value isn't a valid 24-hour time. */
export function clockMinutes(time: string): number | null {
  const match = /^(\d{2}):(\d{2})/.exec(time);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

/** Minutes of the day → "HH:MM" (wrapping past midnight). */
export function clockTime(minutesOfDay: number): string {
  const wrapped = ((minutesOfDay % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

/**
 * Minutes after departure for a wall-clock `time`, choosing the first occurrence at or after
 * `notBefore` minutes — so a 00:30 stop after a 20:30 departure lands on the next day.
 */
export function offsetForClockTime(
  time: string,
  departureTime: string,
  notBefore: number,
): number | null {
  const target = clockMinutes(time);
  const start = clockMinutes(departureTime);
  if (target === null || start === null) return null;
  const earliest = start + notBefore;
  return notBefore + (((target - earliest) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/** How many calendar days after the departure day a moment `offset` minutes later falls. */
export function dayOffset(departureTime: string, offset: number): number {
  return Math.floor(((clockMinutes(departureTime) ?? 0) + offset) / MINUTES_PER_DAY);
}

/** Whole calendar days from one YYYY-MM-DD date to another. */
export function daysBetween(fromDate: string, toDate: string): number {
  return Math.round(
    (Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / (MINUTES_PER_DAY * MINUTE_MS),
  );
}

/** YYYY-MM-DD moved by whole days. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * MINUTES_PER_DAY * MINUTE_MS)
    .toISOString()
    .slice(0, 10);
}

/** 24-hour Sri Lankan time of an instant, e.g. "20:30". */
export function formatTime(iso: string): string {
  return sriLankaParts(iso).time;
}

/** 12-hour Sri Lankan time for customers, e.g. "8:30 PM". */
export function formatClock(iso: string): string {
  const [hours, minutes] = sriLankaParts(iso).time.split(":").map(Number);
  const suffix = hours < 12 ? "AM" : "PM";
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

/** Journey length as "9h 00m" (or "45m"). */
export function formatJourney(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = String(minutes % 60).padStart(2, "0");
  return hours ? `${hours}h ${rest}m` : `${minutes}m`;
}

/** A countdown as "4:05" (minutes:seconds). */
export function formatCountdown(milliseconds: number): string {
  const total = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Calendar days between two instants' Sri Lankan dates (1 for an overnight arrival). */
export function dayShift(fromIso: string, toIso: string): number {
  return daysBetween(sriLankaParts(fromIso).date, sriLankaParts(toIso).date);
}

/** "Tue, 15 Sep 2026" for a YYYY-MM-DD date. */
export function formatDay(date: string, { year = true }: { year?: boolean } = {}): string {
  const [y, m, d] = date.split("-").map(Number);
  const weekday = WEEKDAYS[(new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7].short;
  return `${weekday}, ${d} ${MONTHS[m - 1]}${year ? ` ${y}` : ""}`;
}

/** Sri Lankan calendar day of an instant, formatted: "Tue, 15 Sep 2026". */
export function formatTripDate(iso: string, options?: { year?: boolean }): string {
  return formatDay(sriLankaParts(iso).date, options);
}

/** "Daily", "Weekdays", "Weekends" or "Mon, Wed, Fri". */
export function describeWeekdays(days: readonly number[]): string {
  const sorted = [...new Set(days)].sort();
  if (sorted.length === 7) return "Daily";
  if (sorted.join() === "0,1,2,3,4") return "Weekdays";
  if (sorted.join() === "5,6") return "Weekends";
  return sorted.map((day) => WEEKDAYS[day].short).join(", ");
}
