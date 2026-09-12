"use client";

import type { ReactNode } from "react";
import { Controller, type Control, type FieldValues, type Path } from "react-hook-form";

import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

// Radix Select can't use "" as an item value, so an explicit "none" choice maps to "".
const NONE = "__none__";

// Long option labels (e.g. "WP NC-4521 · Batticaloa Night Express (Ceylon Coach Services)")
// end in an ellipsis instead of pushing the trigger out of narrow layouts.
const TRUNCATE_VALUE = "*:data-[slot=select-value]:block *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:truncate";

interface SelectFieldProps<T extends FieldValues> {
  control: Control<T>;
  name: Path<T>;
  label: string;
  options: SelectOption[];
  placeholder?: string;
  description?: ReactNode;
  /** Label for an extra option that sets the value to "" (e.g. "No layout"). */
  emptyOptionLabel?: string;
  disabled?: boolean;
  className?: string;
  /** Called after the form value changes (for dependent defaults). */
  onValueChange?: (value: string) => void;
}

export function SelectField<T extends FieldValues>({
  control,
  name,
  label,
  options,
  placeholder = "Select…",
  description,
  emptyOptionLabel,
  disabled,
  className,
  onValueChange,
}: SelectFieldProps<T>) {
  const id = `field-${name}`;
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const raw = (field.value as string | undefined) ?? "";
        const value = raw === "" && emptyOptionLabel ? NONE : raw;
        return (
          <Field data-invalid={fieldState.invalid} className={cn("min-w-0", className)}>
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            <Select
              value={value}
              onValueChange={(next) => {
                const resolved = next === NONE ? "" : next;
                field.onChange(resolved);
                onValueChange?.(resolved);
              }}
              disabled={disabled}
              name={field.name}
            >
              <SelectTrigger
                id={id}
                ref={field.ref}
                onBlur={field.onBlur}
                aria-invalid={fieldState.invalid}
                aria-describedby={fieldState.invalid ? `${id}-error` : undefined}
                className={cn("h-11 w-full min-w-0", TRUNCATE_VALUE)}
              >
                <SelectValue placeholder={placeholder} />
              </SelectTrigger>
              <SelectContent position="popper" className="max-h-72">
                {emptyOptionLabel && <SelectItem value={NONE}>{emptyOptionLabel}</SelectItem>}
                {options.map((option) => (
                  <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {description && <FieldDescription>{description}</FieldDescription>}
            {fieldState.invalid && <FieldError id={`${id}-error`} errors={[fieldState.error]} />}
          </Field>
        );
      }}
    />
  );
}

/** Compact, unbound select for list filters. `"all"` means "no filter". */
export function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel = "All",
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  allLabel?: string;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className={cn("h-10 w-full min-w-0 sm:w-44", TRUNCATE_VALUE, className)}>
        <span className="text-muted-foreground">{label}:</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-72">
        <SelectItem value="all">{allLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
