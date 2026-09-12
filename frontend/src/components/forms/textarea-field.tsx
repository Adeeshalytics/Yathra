"use client";

import type { ComponentProps, ReactNode } from "react";
import { Controller, type Control, type FieldValues, type Path } from "react-hook-form";

import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

export function TextareaField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  ...textareaProps
}: Omit<ComponentProps<typeof Textarea>, "name" | "value" | "defaultValue" | "onChange"> & {
  control: Control<T>;
  name: Path<T>;
  label: string;
  description?: ReactNode;
}) {
  const id = `field-${name}`;
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <Textarea
            {...textareaProps}
            {...field}
            value={(field.value as string | undefined) ?? ""}
            id={id}
            aria-invalid={fieldState.invalid}
            aria-describedby={fieldState.invalid ? `${id}-error` : undefined}
          />
          {description && <FieldDescription>{description}</FieldDescription>}
          {fieldState.invalid && <FieldError id={`${id}-error`} errors={[fieldState.error]} />}
        </Field>
      )}
    />
  );
}
