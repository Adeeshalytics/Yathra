"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { ArrowRightLeftIcon, MapPinIcon, SearchIcon, UsersIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ComponentType } from "react";
import { Controller, useForm, type Control } from "react-hook-form";

import { ErrorState } from "@/components/common/error-state";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { catalogApi } from "@/lib/api/endpoints";
import { queryKeys } from "@/lib/api/query-keys";
import type { Stop } from "@/lib/api/types";
import { todayInSriLanka } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  MAX_PASSENGERS,
  searchHref,
  tripSearchSchema,
  type TripSearchValues,
} from "@/lib/validations/search";

const PASSENGER_OPTIONS = Array.from({ length: MAX_PASSENGERS }, (_, index) => String(index + 1));

export function stopLabel(stop: Stop): string {
  return stop.name === stop.city ? stop.name : `${stop.name}, ${stop.city}`;
}

export function useStops() {
  return useQuery({
    queryKey: queryKeys.stops,
    queryFn: ({ signal }) => catalogApi.stops(signal),
    staleTime: 5 * 60_000,
  });
}

interface SelectFieldProps {
  control: Control<TripSearchValues>;
  name: "from" | "to" | "passengers";
  label: string;
  placeholder: string;
  icon: ComponentType<{ className?: string }>;
  options: { value: string; label: string }[];
  disabled?: boolean;
}

function SelectField({ control, name, label, placeholder, icon: Icon, options, disabled }: SelectFieldProps) {
  const id = `search-${name}`;
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <Select value={field.value} onValueChange={field.onChange} disabled={disabled} name={field.name}>
            <SelectTrigger
              id={id}
              ref={field.ref}
              onBlur={field.onBlur}
              aria-invalid={fieldState.invalid}
              aria-describedby={fieldState.invalid ? `${id}-error` : undefined}
              className="h-11 w-full bg-background text-base md:text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <SelectValue placeholder={placeholder} />
              </span>
            </SelectTrigger>
            <SelectContent position="popper" className="max-h-72">
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {fieldState.invalid && <FieldError id={`${id}-error`} errors={[fieldState.error]} />}
        </Field>
      )}
    />
  );
}

export function TripSearchForm({
  defaultValues,
  submitLabel = "Search buses",
  className,
}: {
  defaultValues?: TripSearchValues;
  submitLabel?: string;
  className?: string;
}) {
  const router = useRouter();
  const stopsQuery = useStops();
  const today = todayInSriLanka();

  const form = useForm<TripSearchValues>({
    resolver: zodResolver(tripSearchSchema),
    defaultValues: defaultValues ?? { from: "", to: "", date: today, passengers: "1" },
  });

  const stopOptions = (stopsQuery.data?.results ?? []).map((stop) => ({
    value: stop.id,
    label: stopLabel(stop),
  }));
  const stopsUnavailable = stopsQuery.isPending || stopsQuery.isError;

  const swapStops = () => {
    const { from, to } = form.getValues();
    const shouldValidate = form.formState.isSubmitted;
    form.setValue("from", to, { shouldValidate });
    form.setValue("to", from, { shouldValidate });
  };

  const onSubmit = form.handleSubmit((values) => router.push(searchHref(values)));

  return (
    <form onSubmit={onSubmit} noValidate aria-label="Search for buses" className={cn("space-y-4", className)}>
      {stopsQuery.isError && (
        <ErrorState
          title="Locations couldn’t be loaded"
          error={stopsQuery.error}
          onRetry={() => void stopsQuery.refetch()}
        />
      )}

      <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-start">
        <SelectField
          control={form.control}
          name="from"
          label="From"
          placeholder={stopsQuery.isPending ? "Loading locations…" : "Leaving from"}
          icon={MapPinIcon}
          options={stopOptions}
          disabled={stopsUnavailable}
        />
        <Button
          type="button"
          variant="outline"
          size="icon-lg"
          onClick={swapStops}
          className="-my-1 justify-self-end rounded-full sm:mt-7 sm:justify-self-center"
          aria-label="Swap departure and destination"
        >
          <ArrowRightLeftIcon className="rotate-90 sm:rotate-0" />
        </Button>
        <SelectField
          control={form.control}
          name="to"
          label="To"
          placeholder={stopsQuery.isPending ? "Loading locations…" : "Going to"}
          icon={MapPinIcon}
          options={stopOptions}
          disabled={stopsUnavailable}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Controller
          control={form.control}
          name="date"
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="search-date">Travel date</FieldLabel>
              <Input
                {...field}
                id="search-date"
                type="date"
                min={today}
                aria-invalid={fieldState.invalid}
                aria-describedby={fieldState.invalid ? "search-date-error" : undefined}
                className="h-11 bg-background"
              />
              {fieldState.invalid && <FieldError id="search-date-error" errors={[fieldState.error]} />}
            </Field>
          )}
        />
        <SelectField
          control={form.control}
          name="passengers"
          label="Passengers"
          placeholder="Passengers"
          icon={UsersIcon}
          options={PASSENGER_OPTIONS.map((count) => ({
            value: count,
            label: `${count} ${count === "1" ? "passenger" : "passengers"}`,
          }))}
        />
      </div>

      <Button type="submit" variant="cta" size="xl" className="w-full">
        <SearchIcon data-icon="inline-start" />
        {submitLabel}
      </Button>
    </form>
  );
}
