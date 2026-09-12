"use client";

import type { ReactNode } from "react";
import { Controller, type Control, type FieldValues, type Path } from "react-hook-form";

import { Checkbox } from "@/components/ui/checkbox";
import { FieldDescription, FieldError, FieldLegend, FieldSet } from "@/components/ui/field";
import { Label } from "@/components/ui/label";

export interface CheckboxOption {
  value: string;
  label: ReactNode;
  icon?: ReactNode;
}

/** Multi-select as a group of checkboxes, bound to a string[] form value. */
export function CheckboxGroupField<T extends FieldValues>({
  control,
  name,
  legend,
  options,
  description,
  lockedValues = [],
}: {
  control: Control<T>;
  name: Path<T>;
  legend: string;
  options: CheckboxOption[];
  description?: ReactNode;
  /** Values that are forced on (shown checked and disabled). */
  lockedValues?: readonly string[];
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const selected = new Set<string>((field.value as string[] | undefined) ?? []);
        const toggle = (value: string, checked: boolean) => {
          const next = new Set(selected);
          if (checked) next.add(value);
          else next.delete(value);
          // Keep the options' order so the payload is stable.
          field.onChange(options.map((o) => o.value).filter((v) => next.has(v)));
        };
        return (
          <FieldSet>
            <FieldLegend variant="label">{legend}</FieldLegend>
            {description && <FieldDescription>{description}</FieldDescription>}
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {options.map((option) => {
                const id = `field-${name}-${option.value}`;
                const locked = lockedValues.includes(option.value);
                return (
                  <Label
                    key={option.value}
                    htmlFor={id}
                    className="flex cursor-pointer items-center gap-3 rounded-xl border p-3 font-normal has-data-checked:border-primary/40 has-data-checked:bg-primary/5 has-disabled:cursor-not-allowed"
                  >
                    <Checkbox
                      id={id}
                      checked={locked || selected.has(option.value)}
                      disabled={locked}
                      onCheckedChange={(checked) => toggle(option.value, checked === true)}
                    />
                    {option.icon}
                    <span>{option.label}</span>
                  </Label>
                );
              })}
            </div>
            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
          </FieldSet>
        );
      }}
    />
  );
}
