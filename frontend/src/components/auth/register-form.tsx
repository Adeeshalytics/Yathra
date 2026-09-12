"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { PasswordField } from "@/components/forms/password-field";
import { TextField } from "@/components/forms/text-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { useAuth } from "@/hooks/use-auth";
import type { UserRole } from "@/lib/api/types";
import { postLoginPath } from "@/lib/auth/roles";
import { applyApiErrors } from "@/lib/forms";
import { registerSchema, type RegisterValues } from "@/lib/validations/auth";

import { RedirectIfAuthenticated } from "./require-auth";

/** Self-service sign-up creates customer accounts only; operators and admins are provisioned. */
export function RegisterForm({ next }: { next?: string }) {
  const { register } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: "", email: "", phone: "", password: "", confirmPassword: "" },
  });

  const mutation = useMutation({
    mutationFn: ({ name, email, phone, password }: RegisterValues) =>
      register({ name, email, phone, password }),
    onSuccess: (user) => toast.success(`Welcome aboard, ${user.name.split(" ")[0]}!`),
    onError: (error) =>
      setFormError(
        applyApiErrors(error, form.setError, ["name", "email", "phone", "password"]),
      ),
  });

  const destination = useCallback((role: UserRole) => postLoginPath(role, next), [next]);

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    mutation.mutate(values);
  });

  return (
    <>
      <RedirectIfAuthenticated to={destination} />
      <form onSubmit={onSubmit} noValidate className="space-y-6">
        {formError && (
          <Alert variant="destructive" className="bg-destructive/5">
            <TriangleAlertIcon />
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        )}
        <FieldGroup>
          <TextField
            control={form.control}
            name="name"
            label="Full name"
            autoComplete="name"
            placeholder="Kasuni Fernando"
          />
          <TextField
            control={form.control}
            name="email"
            label="Email"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
          />
          <TextField
            control={form.control}
            name="phone"
            label="Mobile number"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            placeholder="077 123 4567"
            description="We’ll send booking confirmations to this number."
          />
          <PasswordField
            control={form.control}
            name="password"
            label="Password"
            autoComplete="new-password"
            description="At least 8 characters. Avoid common or all-number passwords."
          />
          <PasswordField
            control={form.control}
            name="confirmPassword"
            label="Confirm password"
            autoComplete="new-password"
          />
        </FieldGroup>
        <Button type="submit" size="xl" className="w-full" disabled={mutation.isPending}>
          {mutation.isPending && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
          Create account
        </Button>
      </form>
    </>
  );
}
