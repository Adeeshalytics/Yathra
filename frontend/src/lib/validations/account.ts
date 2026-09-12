import { z } from "zod";

import { isValidPhone } from "./phone";

export const profileSchema = z.object({
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
});

export type ProfileValues = z.infer<typeof profileSchema>;

export const changePasswordSchema = z
  .object({
    current_password: z.string().min(1, { error: "Enter your current password." }),
    new_password: z
      .string()
      .min(8, { error: "Use at least 8 characters." })
      .max(128, { error: "Password is too long." })
      .refine((value) => !/^\d+$/.test(value), { error: "Password can’t be only numbers." }),
    confirm_password: z.string().min(1, { error: "Confirm your new password." }),
  })
  .refine((values) => values.new_password === values.confirm_password, {
    error: "Passwords don’t match.",
    path: ["confirm_password"],
  })
  .refine((values) => values.new_password !== values.current_password, {
    error: "Choose a password you aren’t already using.",
    path: ["new_password"],
  });

export type ChangePasswordValues = z.infer<typeof changePasswordSchema>;
