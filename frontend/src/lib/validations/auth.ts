import { z } from "zod";

import { isValidPhone } from "./phone";

export const loginSchema = z.object({
  email: z.email({ error: "Enter a valid email address." }),
  password: z.string().min(1, { error: "Enter your password." }),
});

export type LoginValues = z.infer<typeof loginSchema>;

export const registerSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, { error: "Enter your full name." })
      .max(150, { error: "Name is too long." }),
    email: z.email({ error: "Enter a valid email address." }),
    phone: z
      .string()
      .trim()
      .min(1, { error: "Enter your mobile number." })
      .refine(isValidPhone, { error: "Enter a valid phone number, e.g. 077 123 4567." }),
    password: z
      .string()
      .min(8, { error: "Use at least 8 characters." })
      .max(128, { error: "Password is too long." })
      .refine((value) => !/^\d+$/.test(value), { error: "Password can’t be only numbers." }),
    confirmPassword: z.string().min(1, { error: "Confirm your password." }),
  })
  .refine((values) => values.password === values.confirmPassword, {
    error: "Passwords don’t match.",
    path: ["confirmPassword"],
  });

export type RegisterValues = z.infer<typeof registerSchema>;
