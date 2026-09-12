import { z } from "zod";

import type { BookingPassenger, PassengerInput } from "@/lib/api/booking-types";
import type { User } from "@/lib/api/types";

import { isValidPhone } from "./phone";

const EMAIL = z.email();

export const passengerSchema = z.object({
  seat_number: z.string(),
  name: z
    .string()
    .trim()
    .min(2, { error: "Enter the passenger’s full name." })
    .max(150, { error: "This name is too long." }),
  phone: z
    .string()
    .trim()
    .min(1, { error: "Enter a phone number." })
    .refine(isValidPhone, { error: "Enter a valid phone number, e.g. 077 123 4567." }),
  email: z
    .string()
    .trim()
    .min(1, { error: "Enter an email address." })
    .refine((value) => EMAIL.safeParse(value).success, { error: "Enter a valid email address." }),
});

export const passengersSchema = z.object({ passengers: z.array(passengerSchema).min(1) });

export type PassengersFormValues = z.infer<typeof passengersSchema>;

/**
 * One entry per seat. Details already on the booking are kept; otherwise the signed-in
 * customer's contact details are suggested (and their name for the first passenger).
 */
export function passengerDefaults(
  seats: readonly string[],
  user?: Pick<User, "name" | "phone" | "email"> | null,
  existing: readonly BookingPassenger[] = [],
): PassengersFormValues {
  return {
    passengers: seats.map((seat, index) => {
      const known = existing.find((passenger) => passenger.seat_number === seat);
      if (known) {
        return { seat_number: seat, name: known.name, phone: known.phone, email: known.email };
      }
      return {
        seat_number: seat,
        name: index === 0 ? (user?.name ?? "") : "",
        phone: user?.phone ?? "",
        email: user?.email ?? "",
      };
    }),
  };
}

export function toPassengerInputs(values: PassengersFormValues): PassengerInput[] {
  return values.passengers.map((passenger) => ({
    seat_number: passenger.seat_number,
    name: passenger.name.trim().replace(/\s+/g, " "),
    phone: passenger.phone.trim(),
    email: passenger.email.trim().toLowerCase(),
  }));
}
