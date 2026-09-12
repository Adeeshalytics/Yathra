/**
 * Trip & schedule forms. Stop times are edited as minutes after departure so they move with
 * the departure; the UI shows them as Sri Lankan clock times. The API re-validates everything.
 */
import { z } from "zod";

import type {
  AdminRouteDetail,
  AdminTripDetail,
  AdminTripSchedule,
  TripPayload,
  TripSchedulePayload,
  TripStatus,
} from "@/lib/api/admin-types";
import { addMinutes, minutesBetween, sriLankaDateTime, sriLankaParts } from "@/lib/datetime";

export const MAX_JOURNEY_MINUTES = 72 * 60;

export const TRIP_STATUSES: { value: TripStatus; label: string }[] = [
  { value: "scheduled", label: "Scheduled" },
  { value: "boarding", label: "Boarding" },
  { value: "departed", label: "Departed" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

/** Manual status moves (mirrors apps/trips/models.py). Cancelling is a separate action. */
export const STATUS_TRANSITIONS: Record<TripStatus, TripStatus[]> = {
  scheduled: ["boarding", "departed"],
  boarding: ["scheduled", "departed"],
  departed: ["completed"],
  completed: [],
  cancelled: [],
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const price = z
  .string()
  .trim()
  .refine((value) => value === "" || (/^\d+(\.\d{1,2})?$/.test(value) && Number(value) <= 100000), {
    error: "Enter a price of 0 or more (LKR, up to 2 decimals).",
  });

const stopBrief = z.object({ id: z.string(), name: z.string(), city: z.string(), active: z.boolean() });

export const tripStopRowSchema = z.object({
  sequence: z.number(),
  stop: stopBrief,
  /** Minutes after the trip leaves the origin. */
  arrival: z.number(),
  departure: z.number(),
  boarding: z.boolean(),
  dropoff: z.boolean(),
});

export type TripStopRow = z.infer<typeof tripStopRowSchema>;

/** Timetable rules (mirrors apps/trips/services.py). Issues point at the offending row. */
export function checkTripStops(
  rows: TripStopRow[],
  addIssue: (message: string, path: (string | number)[]) => void,
) {
  if (rows.length < 2) {
    addIssue("Choose a route with a stop timetable.", []);
    return;
  }
  rows.forEach((row, index) => {
    if (row.departure < row.arrival) addIssue("Can’t leave before arriving.", [index, "departure"]);
    if (index > 0) {
      const previous = rows[index - 1];
      if (row.arrival <= previous.departure) {
        addIssue(`Must arrive after leaving ${previous.stop.name}.`, [index, "arrival"]);
      }
    }
  });
  const last = rows.length - 1;
  if (rows[last].arrival > MAX_JOURNEY_MINUTES) {
    addIssue("A journey can’t take longer than 72 hours.", [last, "arrival"]);
  }
}

export const tripSchema = z
  .object({
    route: z.string().min(1, { error: "Choose a route." }),
    bus: z.string().min(1, { error: "Choose a bus." }),
    date: z.string().regex(DATE, { error: "Choose the departure date." }),
    time: z.string().regex(TIME, { error: "Choose the departure time." }),
    base_price: price,
    active: z.boolean(),
    stops: z.array(tripStopRowSchema),
  })
  .superRefine((values, ctx) => {
    checkTripStops(values.stops, (message, path) =>
      ctx.addIssue({ code: "custom", message, path: ["stops", ...path] }),
    );
  });

export type TripFormValues = z.infer<typeof tripSchema>;

export function rowsFromRoute(route: AdminRouteDetail): TripStopRow[] {
  return route.stops.map((stop) => ({
    sequence: stop.sequence,
    stop: stop.stop,
    arrival: stop.arrival_offset_minutes,
    departure: stop.departure_offset_minutes,
    boarding: stop.is_boarding_point,
    dropoff: stop.is_dropoff_point,
  }));
}

export function rowsFromTrip(trip: AdminTripDetail): TripStopRow[] {
  return trip.stops.map((stop) => ({
    sequence: stop.sequence,
    stop: stop.stop,
    arrival: minutesBetween(trip.departure_datetime, stop.arrival_datetime),
    departure: minutesBetween(trip.departure_datetime, stop.departure_datetime),
    boarding: stop.is_boarding_point,
    dropoff: stop.is_dropoff_point,
  }));
}

export function tripFormDefaults(trip?: AdminTripDetail): TripFormValues {
  if (!trip) return { route: "", bus: "", date: "", time: "", base_price: "", active: true, stops: [] };
  const { date, time } = sriLankaParts(trip.departure_datetime);
  return {
    route: trip.route,
    bus: trip.bus,
    date,
    time,
    base_price: trip.base_price,
    active: trip.active,
    stops: rowsFromTrip(trip),
  };
}

export function toTripPayload(values: TripFormValues): TripPayload {
  const departure = sriLankaDateTime(values.date, values.time);
  return {
    route: values.route,
    bus: values.bus,
    departure_datetime: departure,
    ...(values.base_price.trim() !== "" && { base_price: values.base_price.trim() }),
    active: values.active,
    stops: values.stops.map((row) => ({
      sequence: row.sequence,
      arrival_datetime: addMinutes(departure, row.arrival),
      departure_datetime: addMinutes(departure, row.departure),
    })),
  };
}

// ---------------------------------------------------------------------------
// Recurring schedules
// ---------------------------------------------------------------------------
export const RECURRENCES = [
  { value: "daily", label: "Every day" },
  { value: "weekly", label: "Selected weekdays" },
] as const;

export const scheduleSchema = z
  .object({
    route: z.string().min(1, { error: "Choose a route." }),
    bus: z.string().min(1, { error: "Choose a bus." }),
    departure_time: z.string().regex(TIME, { error: "Choose the departure time." }),
    base_price: price,
    recurrence: z.enum(["daily", "weekly"]),
    weekdays: z.array(z.number().int().min(0).max(6)),
    start_date: z.string().regex(DATE, { error: "Choose the first day of the schedule." }),
    end_date: z.string().refine((value) => value === "" || DATE.test(value), {
      error: "Enter a valid date, or leave it empty.",
    }),
    active: z.boolean(),
  })
  .superRefine((values, ctx) => {
    if (values.recurrence === "weekly" && values.weekdays.length === 0) {
      ctx.addIssue({ code: "custom", message: "Pick at least one weekday.", path: ["weekdays"] });
    }
    if (values.end_date && values.end_date < values.start_date) {
      ctx.addIssue({
        code: "custom",
        message: "The end date can’t be before the start date.",
        path: ["end_date"],
      });
    }
  });

export type ScheduleFormValues = z.infer<typeof scheduleSchema>;

export function scheduleFormDefaults(
  schedule: AdminTripSchedule | undefined,
  today: string,
): ScheduleFormValues {
  if (!schedule) {
    return {
      route: "",
      bus: "",
      departure_time: "",
      base_price: "",
      recurrence: "daily",
      weekdays: [],
      start_date: today,
      end_date: "",
      active: true,
    };
  }
  return {
    route: schedule.route,
    bus: schedule.bus,
    departure_time: schedule.departure_time.slice(0, 5),
    base_price: schedule.base_price,
    recurrence: schedule.recurrence,
    weekdays: schedule.weekdays,
    start_date: schedule.start_date,
    end_date: schedule.end_date ?? "",
    active: schedule.active,
  };
}

export function toSchedulePayload(values: ScheduleFormValues): TripSchedulePayload {
  return {
    route: values.route,
    bus: values.bus,
    departure_time: values.departure_time,
    ...(values.base_price.trim() !== "" && { base_price: values.base_price.trim() }),
    recurrence: values.recurrence,
    weekdays: values.recurrence === "weekly" ? [...new Set(values.weekdays)].sort() : [],
    start_date: values.start_date,
    end_date: values.end_date || null,
    active: values.active,
  };
}
