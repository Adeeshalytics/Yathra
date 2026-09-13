"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { InfoIcon, Loader2Icon, TriangleAlertIcon } from "lucide-react";
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
import { clearPhoneProof, type PendingPhoneLink } from "@/lib/auth/phone-proof";
import { postLoginPath } from "@/lib/auth/roles";
import { firstName } from "@/lib/format";
import { applyApiErrors } from "@/lib/forms";
import { loginSchema, type LoginValues } from "@/lib/validations/auth";

import { RedirectIfAuthenticated } from "./require-auth";

/** One sign-in form for every role; the redirect after login depends on the user's role. */
export function LoginForm({
  next,
  phoneLink,
}: {
  next?: string;
  /** A texted code proved a phone that belongs to this account: signing in links it. */
  phoneLink?: PendingPhoneLink | null;
}) {
  const { login } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const mutation = useMutation({
    // Wrapped, so TanStack Query does not pass its own second argument through to login.
    mutationFn: (values: LoginValues) =>
      login(phoneLink ? { ...values, phone_proof: phoneLink.proof } : values),
    onSuccess: (user) => {
      if (phoneLink) clearPhoneProof();
      const name = firstName(user.name);
      if (phoneLink && user.phone_verified) {
        toast.success("Number linked. Next time, a texted code is all you need.");
      } else {
        toast.success(name ? `Welcome back, ${name}!` : "Welcome back!");
      }
    },
    onError: (error) => setFormError(applyApiErrors(error, form.setError, ["email", "password"])),
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
        {phoneLink && (
          <Alert>
            <InfoIcon />
            <AlertDescription>
              {phoneLink.phone} is on an account with a password. Sign in once with your email and
              password to link the number.
            </AlertDescription>
          </Alert>
        )}
        {formError && (
          <Alert variant="destructive" className="bg-destructive/5">
            <TriangleAlertIcon />
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        )}
        <FieldGroup>
          <TextField
            control={form.control}
            name="email"
            label="Email"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
          />
          <PasswordField
            control={form.control}
            name="password"
            label="Password"
            autoComplete="current-password"
          />
        </FieldGroup>
        <Button type="submit" size="xl" className="w-full" disabled={mutation.isPending}>
          {mutation.isPending && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
          Sign in
        </Button>
      </form>
    </>
  );
}
