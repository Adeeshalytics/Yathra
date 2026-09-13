/**
 * Zod schemas for the admin forms. Numeric inputs are kept as strings while editing and
 * converted by the `to*Payload` helpers. The API re-validates everything.
 */
import { z } from "zod";

import type {
  BusFacility,
  BusPayload,
  BusType,
  OperatorPayload,
  RoutePayload,
  StopBrief,
  StopPayload,
} from "@/lib/api/admin-types";
import type { OperatorStatus } from "@/lib/api/types";

import { isValidPhone } from "./phone";

const trimmed = (min: number, message: string, max = 200) =>
  z.string().trim().min(min, { error: message }).max(max, { error: "This is too long." });

// ---------------------------------------------------------------------------
// Operators
// ---------------------------------------------------------------------------
export const OPERATOR_STATUSES: { value: OperatorStatus; label: string }[] = [
  { value: "pending", label: "Pending approval" },
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
];

export const operatorSchema = z.object({
  company_name: trimmed(2, "Enter the company name."),
  registration_number: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9 /-]{2,63}$/, {
      error: "Use letters, digits, spaces, slashes or dashes, e.g. PV-00012345.",
    }),
  contact_phone: z
    .string()
    .trim()
    .min(1, { error: "Enter a contact phone number." })
    .refine(isValidPhone, { error: "Enter a valid phone number, e.g. 011 234 5678." }),
  contact_email: z.email({ error: "Enter a valid email address." }),
  address: trimmed(5, "Enter the full business address.", 500),
  status: z.enum(["pending", "active", "suspended"]),
});

export type OperatorFormValues = z.infer<typeof operatorSchema>;

export function toOperatorPayload(values: OperatorFormValues): OperatorPayload {
  return { ...values, contact_email: values.contact_email.trim().toLowerCase() };
}

// ---------------------------------------------------------------------------
// Buses
// ---------------------------------------------------------------------------
export const BUS_TYPES: { value: BusType; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "ac", label: "AC" },
  { value: "luxury", label: "Luxury" },
  { value: "super_luxury", label: "Super Luxury" },
];

export const BUS_FACILITIES: { value: BusFacility; label: string }[] = [
  { value: "ac", label: "AC" },
  { value: "wifi", label: "WiFi" },
  { value: "usb_charging", label: "USB charging" },
  { value: "reclining_seats", label: "Reclining seats" },
  { value: "tv", label: "TV" },
  { value: "toilet", label: "Toilet" },
];

/** Classes that are air-conditioned by definition (the API adds the AC facility for them). */
export const AIR_CONDITIONED_BUS_TYPES: readonly BusType[] = ["ac", "luxury", "super_luxury"];

// Mirrors apps/fleet/validators.py: "WP NB-1234", "WP-NB-1234", "NB-1234", "65-1234".
export const REGISTRATION_PATTERN = /^(?:[A-Z]{2}(?: |-(?=[A-Z])))?(?:[A-Z]{1,3}|\d{1,3}) ?-? ?\d{4}$/;

export function normalizeRegistration(value: string): string {
  return value.toUpperCase().replace(/[–—]/g, "-").split(/\s+/).filter(Boolean).join(" ");
}

export const busSchema = z.object({
  operator: z.string().min(1, { error: "Choose the operator that runs this bus." }),
  registration_number: z
    .string()
    .trim()
    .refine((value) => REGISTRATION_PATTERN.test(normalizeRegistration(value)), {
      error: "Enter a Sri Lankan registration number, e.g. NB-1234 or WP NB-1234.",
    }),
  name: trimmed(2, "Enter a name for this bus.", 100),
  bus_type: z.enum(["normal", "ac", "luxury", "super_luxury"]),
  seat_layout: z.string(),
  seat_capacity: z.string().refine(
    (value) => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 90,
    { error: "Enter a capacity between 1 and 90 seats." },
  ),
  facilities: z.array(z.enum(["ac", "wifi", "usb_charging", "reclining_seats", "tv", "toilet"])),
  active: z.boolean(),
});

export type BusFormValues = z.infer<typeof busSchema>;

export function toBusPayload(values: BusFormValues): BusPayload {
  return {
    ...values,
    registration_number: normalizeRegistration(values.registration_number),
    seat_layout: values.seat_layout || null,
    seat_capacity: Number(values.seat_capacity),
  };
}

// ---------------------------------------------------------------------------
// Seat layouts (the seats themselves are checked by lib/seat-layout.ts)
// ---------------------------------------------------------------------------
export const SEAT_LAYOUT_TYPES: { value: "2x2" | "2x1" | "custom"; label: string }[] = [
  { value: "2x2", label: "2 + 2" },
  { value: "2x1", label: "2 + 1" },
  { value: "custom", label: "Custom" },
];

export const seatLayoutSchema = z.object({
  name: trimmed(2, "Give the layout a name, e.g. 2+2 Standard · 45 seats.", 100),
  layout_type: z.enum(["2x2", "2x1", "custom"]),
  description: z.string().trim().max(500, { error: "Keep the description under 500 characters." }),
  active: z.boolean(),
});

export type SeatLayoutFormValues = z.infer<typeof seatLayoutSchema>;

// ---------------------------------------------------------------------------
// Stops
// ---------------------------------------------------------------------------
const coordinate = (limit: number, label: string) =>
  z.string().trim().refine(
    (value) => value === "" || (/^-?\d{1,3}(\.\d{1,6})?$/.test(value) && Math.abs(Number(value)) <= limit),
    { error: `Enter a ${label} between -${limit} and ${limit} (up to 6 decimals).` },
  );

export const stopSchema = z
  .object({
    name: trimmed(2, "Enter the stop name.", 120),
    city: trimmed(2, "Enter the city.", 80),
    latitude: coordinate(90, "latitude"),
    longitude: coordinate(180, "longitude"),
    active: z.boolean(),
  })
  .refine((values) => (values.latitude === "") === (values.longitude === ""), {
    error: "Enter both latitude and longitude, or leave both empty.",
    path: ["longitude"],
  });

export type StopFormValues = z.infer<typeof stopSchema>;

export function toStopPayload(values: StopFormValues): StopPayload {
  return {
    ...values,
    latitude: values.latitude.trim() || null,
    longitude: values.longitude.trim() || null,
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
const minutes = z
  .string()
  .trim()
  .refine((value) => /^\d+$/.test(value) && Number(value) <= 72 * 60, {
    error: "Minutes (0–4320).",
  });

export const routeStopSchema = z.object({
  stop: z.object({
    id: z.string(),
    name: z.string(),
    city: z.string(),
    active: z.boolean(),
    // Carried through the form so the route can be drawn while it is being edited.
    latitude: z.string().nullable(),
    longitude: z.string().nullable(),
  }),
  arrival: minutes,
  departure: minutes,
  boarding: z.boolean(),
  dropoff: z.boolean(),
});

export type RouteStopFormValues = z.infer<typeof routeStopSchema>;

/** Timetable rules (mirrors apps/routes/services.py). Issues point at the offending row. */
export function checkRouteStops(
  stops: RouteStopFormValues[],
  addIssue: (message: string, path: (string | number)[]) => void,
) {
  if (stops.length < 2) {
    addIssue("A route needs at least two stops: an origin and a destination.", []);
    return;
  }
  const seen = new Map<string, number>();
  stops.forEach((row, index) => {
    const previousIndex = seen.get(row.stop.id);
    if (previousIndex !== undefined) {
      addIssue(`${row.stop.name} is already stop ${previousIndex + 1}.`, [index, "stop"]);
    } else {
      seen.set(row.stop.id, index);
    }
    const arrival = Number(row.arrival);
    const departure = Number(row.departure);
    if (!/^\d+$/.test(row.arrival) || !/^\d+$/.test(row.departure)) return;
    if (departure < arrival) addIssue("Departure can’t be before arrival.", [index, "departure"]);
    if (index === 0 && (arrival !== 0 || departure !== 0)) {
      addIssue("The origin departs at 0 minutes.", [index, "arrival"]);
    }
    if (index > 0) {
      const previous = stops[index - 1];
      if (/^\d+$/.test(previous.departure) && arrival <= Number(previous.departure)) {
        addIssue(`Must arrive after leaving ${previous.stop.name}.`, [index, "arrival"]);
      }
    }
  });
  if (!stops[0].boarding) addIssue("Passengers must be able to board at the origin.", [0, "boarding"]);
  const last = stops.length - 1;
  if (!stops[last].dropoff) {
    addIssue("Passengers must be able to get off at the destination.", [last, "dropoff"]);
  }
}

export const routeSchema = z
  .object({
    name: trimmed(3, "Enter a route name, e.g. Colombo – Kandy.", 150),
    route_number: z.string().trim().max(16, { error: "Use at most 16 characters." }),
    description: z.string().trim().max(2000, { error: "This is too long." }),
    base_fare: z
      .string()
      .trim()
      .refine((value) => value === "" || (/^\d+(\.\d{1,2})?$/.test(value) && Number(value) <= 100000), {
        error: "Enter a fare of 0 or more (LKR, up to 2 decimals).",
      }),
    active: z.boolean(),
    stops: z.array(routeStopSchema),
  })
  .superRefine((values, ctx) => {
    checkRouteStops(values.stops, (message, path) =>
      ctx.addIssue({ code: "custom", message, path: ["stops", ...path] }),
    );
  });

export type RouteFormValues = z.infer<typeof routeSchema>;

export function toRoutePayload(values: RouteFormValues): RoutePayload {
  return {
    name: values.name,
    route_number: values.route_number.toUpperCase(),
    description: values.description,
    base_fare: values.base_fare === "" ? null : values.base_fare,
    active: values.active,
    stops: values.stops.map((row) => ({
      stop: row.stop.id,
      arrival_offset_minutes: Number(row.arrival),
      departure_offset_minutes: Number(row.departure),
      is_boarding_point: row.boarding,
      is_dropoff_point: row.dropoff,
    })),
  };
}

export function newRouteStop(stop: StopBrief, previous?: RouteStopFormValues): RouteStopFormValues {
  if (!previous) return { stop, arrival: "0", departure: "0", boarding: true, dropoff: false };
  const leaves = /^\d+$/.test(previous.departure) ? Number(previous.departure) : 0;
  const arrival = String(leaves + 30);
  return { stop, arrival, departure: arrival, boarding: true, dropoff: true };
}
