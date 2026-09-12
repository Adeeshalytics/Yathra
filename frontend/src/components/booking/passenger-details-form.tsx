"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeftIcon, Loader2Icon, UserRoundIcon } from "lucide-react";
import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";

import { FormErrorAlert } from "@/components/admin/shared/page-parts";
import { TextField } from "@/components/forms/text-field";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import type { PassengerInput } from "@/lib/api/booking-types";
import { getErrorMessage } from "@/lib/api/errors";
import { passengerFieldErrors } from "@/lib/booking";
import { fieldErrorList } from "@/lib/forms";
import {
  passengersSchema,
  toPassengerInputs,
  type PassengersFormValues,
} from "@/lib/validations/booking";

/** Full name, phone and email for every seat. Server validation errors land on the right field. */
export function PassengerDetailsForm({
  id,
  defaultValues,
  submitLabel,
  onSubmit,
  onBack,
  backLabel = "Back",
}: {
  id?: string;
  defaultValues: PassengersFormValues;
  submitLabel: string;
  onSubmit: (passengers: PassengerInput[]) => Promise<unknown>;
  onBack?: () => void;
  backLabel?: string;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<PassengersFormValues>({
    resolver: zodResolver(passengersSchema),
    defaultValues,
  });
  const { fields } = useFieldArray({ control: form.control, name: "passengers" });

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await onSubmit(toPassengerInputs(values));
    } catch (error) {
      const problems = passengerFieldErrors(error);
      problems.forEach(({ index, field, message }, position) =>
        form.setError(`passengers.${index}.${field}`, { type: "server", message }, { shouldFocus: position === 0 }),
      );
      if (problems.length === 0) setFormError(fieldErrorList(error, "passengers")[0] ?? getErrorMessage(error));
    }
  });

  return (
    <form id={id} onSubmit={submit} noValidate className="space-y-5">
      <FormErrorAlert messages={formError ? [formError] : []} />
      {fields.map((field, index) => (
        <fieldset key={field.id} className="rounded-xl border p-4">
          <legend className="flex items-center gap-2 px-1 text-sm font-semibold">
            <UserRoundIcon className="size-4 text-primary" aria-hidden />
            Passenger {index + 1} · Seat {field.seat_number}
          </legend>
          <FieldGroup className="mt-2 grid gap-4 md:grid-cols-3">
            <TextField
              control={form.control}
              name={`passengers.${index}.name`}
              id={`passenger-${index}-name`}
              label="Full name"
              autoComplete={index === 0 ? "name" : "off"}
            />
            <TextField
              control={form.control}
              name={`passengers.${index}.phone`}
              id={`passenger-${index}-phone`}
              label="Phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="077 123 4567"
            />
            <TextField
              control={form.control}
              name={`passengers.${index}.email`}
              id={`passenger-${index}-email`}
              label="Email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="you@example.com"
            />
          </FieldGroup>
        </fieldset>
      ))}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        {onBack ? (
          <Button type="button" variant="outline" size="lg" onClick={onBack}>
            <ArrowLeftIcon data-icon="inline-start" />
            {backLabel}
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" variant="cta" size="lg" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
