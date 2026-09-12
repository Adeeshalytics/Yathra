"use client";

import type { ReactNode } from "react";
import { Controller, type Control, type FieldValues, type Path } from "react-hook-form";

import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";

export function SwitchField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  disabled,
}: {
  control: Control<T>;
  name: Path<T>;
  label: string;
  description?: ReactNode;
  disabled?: boolean;
}) {
  const id = `field-${name}`;
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Field orientation="horizontal" className="rounded-xl border p-4">
          <FieldContent>
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            {description && <FieldDescription>{description}</FieldDescription>}
          </FieldContent>
          <Switch
            id={id}
            checked={Boolean(field.value)}
            onCheckedChange={field.onChange}
            onBlur={field.onBlur}
            disabled={disabled}
          />
        </Field>
      )}
    />
  );
}
