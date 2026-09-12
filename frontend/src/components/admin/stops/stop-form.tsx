"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon } from "lucide-react";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";

import { FormErrorAlert } from "@/components/admin/shared/page-parts";
import { SwitchField } from "@/components/forms/switch-field";
import { TextField } from "@/components/forms/text-field";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import type { AdminStop, StopPayload } from "@/lib/api/admin-types";
import { applyApiErrors } from "@/lib/forms";
import { stopSchema, toStopPayload, type StopFormValues } from "@/lib/validations/admin";

const FIELDS = ["name", "city", "latitude", "longitude", "active"] as const;

export function StopForm({
  stop,
  cities = [],
  submitLabel,
  onSubmit,
  onCancel,
}: {
  stop?: AdminStop | null;
  cities?: readonly string[];
  submitLabel: string;
  onSubmit: (payload: StopPayload) => Promise<unknown>;
  onCancel?: () => void;
}) {
  const citiesId = useId();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<StopFormValues>({
    resolver: zodResolver(stopSchema),
    defaultValues: {
      name: stop?.name ?? "",
      city: stop?.city ?? "",
      latitude: stop?.latitude ?? "",
      longitude: stop?.longitude ?? "",
      active: stop?.active ?? true,
    },
  });

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await onSubmit(toStopPayload(values));
    } catch (error) {
      setFormError(applyApiErrors(error, form.setError, FIELDS));
    }
  });

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <FormErrorAlert messages={formError ? [formError] : []} />
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        <TextField control={form.control} name="name" label="Stop name" placeholder="Kandy Goods Shed" />
        <TextField
          control={form.control}
          name="city"
          label="City / town"
          placeholder="Kandy"
          list={citiesId}
          autoComplete="off"
        />
        <TextField
          control={form.control}
          name="latitude"
          label="Latitude (optional)"
          inputMode="decimal"
          placeholder="7.291900"
        />
        <TextField
          control={form.control}
          name="longitude"
          label="Longitude (optional)"
          inputMode="decimal"
          placeholder="80.630500"
        />
      </FieldGroup>
      <datalist id={citiesId}>
        {cities.map((city) => (
          <option key={city} value={city} />
        ))}
      </datalist>
      <p className="text-xs text-muted-foreground">
        Tip: in Google Maps, right-click the bus stand and copy its coordinates.
      </p>
      <SwitchField
        control={form.control}
        name="active"
        label="Active"
        description="Inactive stops can’t be added to routes or chosen by passengers."
      />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel && (
          <Button type="button" variant="outline" size="lg" onClick={onCancel} disabled={form.formState.isSubmitting}>
            Cancel
          </Button>
        )}
        <Button type="submit" size="lg" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
