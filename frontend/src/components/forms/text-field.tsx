"use client";

import type { ComponentProps, ReactNode } from "react";
import { Controller, type Control, type FieldValues, type Path } from "react-hook-form";

import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface TextFieldProps<T extends FieldValues>
  extends Omit<ComponentProps<typeof Input>, "name" | "value" | "defaultValue" | "onChange"> {
  control: Control<T>;
  name: Path<T>;
  label: string;
  description?: ReactNode;
  /** Rendered inside the input on the right (e.g. a show-password toggle). */
  endAdornment?: ReactNode;
}

/** Labelled, accessible text input bound to React Hook Form, with inline validation errors. */
export function TextField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  endAdornment,
  id,
  className,
  ...inputProps
}: TextFieldProps<T>) {
  const inputId = id ?? `field-${name}`;
  const descriptionId = `${inputId}-description`;
  const errorId = `${inputId}-error`;

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const describedBy = [description ? descriptionId : null, fieldState.invalid ? errorId : null]
          .filter(Boolean)
          .join(" ");
        return (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
            <div className="relative">
              <Input
                {...inputProps}
                {...field}
                value={(field.value as string | undefined) ?? ""}
                id={inputId}
                aria-invalid={fieldState.invalid}
                aria-describedby={describedBy || undefined}
                className={cn("h-11", endAdornment ? "pr-11" : null, className)}
              />
              {endAdornment && (
                <div className="absolute inset-y-0 right-1 flex items-center">{endAdornment}</div>
              )}
            </div>
            {description && <FieldDescription id={descriptionId}>{description}</FieldDescription>}
            {fieldState.invalid && <FieldError id={errorId} errors={[fieldState.error]} />}
          </Field>
        );
      }}
    />
  );
}
