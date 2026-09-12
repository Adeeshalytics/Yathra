"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { BackLink } from "@/components/admin/shared/page-parts";
import { PageHeader } from "@/components/common/page-header";
import { PasswordField } from "@/components/forms/password-field";
import { TextField } from "@/components/forms/text-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { applyApiErrors } from "@/lib/forms";
import {
  changePasswordSchema,
  profileSchema,
  type ChangePasswordValues,
  type ProfileValues,
} from "@/lib/validations/account";

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Alert variant="destructive" className="bg-destructive/5">
      <TriangleAlertIcon />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function ProfileForm({
  defaults,
}: {
  defaults: ProfileValues;
}) {
  const { updateProfile } = useAuth();
  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: defaults,
  });
  const mutation = useMutation({
    mutationFn: (values: ProfileValues) => updateProfile(values),
    onSuccess: (user) => {
      form.reset({ name: user.name, email: user.email, phone: user.phone });
      toast.success("Your details were saved.");
    },
    onError: (error) =>
      form.setError("root", {
        message: applyApiErrors(error, form.setError, ["name", "email", "phone"]) ?? "",
      }),
  });

  const onSubmit = form.handleSubmit((values) => {
    form.clearErrors("root");
    mutation.mutate(values);
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your details</CardTitle>
        <CardDescription>
          Your email address is also how you sign in, and where your tickets are sent.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="space-y-6">
          <FormError message={form.formState.errors.root?.message || null} />
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
              label="Email address"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
            />
            <TextField
              control={form.control}
              name="phone"
              label="Mobile number"
              type="tel"
              autoComplete="tel"
              placeholder="077 123 4567"
              description="We use this if a trip changes."
            />
          </FieldGroup>
          <div className="flex justify-end">
            <Button type="submit" size="xl" disabled={mutation.isPending || !form.formState.isDirty}>
              {mutation.isPending && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
              Save changes
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function PasswordForm() {
  const { changePassword } = useAuth();
  const form = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { current_password: "", new_password: "", confirm_password: "" },
  });
  const mutation = useMutation({
    mutationFn: (values: ChangePasswordValues) =>
      changePassword({
        current_password: values.current_password,
        new_password: values.new_password,
      }),
    onSuccess: () => {
      form.reset();
      toast.success("Your password was changed.");
    },
    onError: (error) =>
      form.setError("root", {
        message:
          applyApiErrors(error, form.setError, ["current_password", "new_password"]) ?? "",
      }),
  });

  const onSubmit = form.handleSubmit((values) => {
    form.clearErrors("root");
    mutation.mutate(values);
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>
          Changing your password signs out any other device using this account.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="space-y-6">
          <FormError message={form.formState.errors.root?.message || null} />
          <FieldGroup>
            <PasswordField
              control={form.control}
              name="current_password"
              label="Current password"
              autoComplete="current-password"
            />
            <PasswordField
              control={form.control}
              name="new_password"
              label="New password"
              autoComplete="new-password"
              description="At least 8 characters, and not only numbers."
            />
            <PasswordField
              control={form.control}
              name="confirm_password"
              label="Confirm new password"
              autoComplete="new-password"
            />
          </FieldGroup>
          <div className="flex justify-end">
            <Button type="submit" size="xl" variant="outline" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
              Change password
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/** The customer's profile: their details, and their password. */
export function ProfileSettings() {
  const { user } = useAuth();

  if (!user) {
    return (
      <div className="space-y-6" aria-busy>
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BackLink href="/account">My account</BackLink>
      <PageHeader title="Profile" description="Keep your contact details and password up to date." />
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <ProfileForm
          key={user.id}
          defaults={{ name: user.name, email: user.email, phone: user.phone }}
        />
        <PasswordForm />
      </div>
    </div>
  );
}
