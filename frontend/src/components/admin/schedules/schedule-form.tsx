"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { Controller, useForm, useWatch, type Control } from "react-hook-form";

import { FormActions, FormErrorAlert } from "@/components/admin/shared/page-parts";
import {
  busSelectOptions,
  routeSelectOptions,
  useBusOptions,
  useRouteOptions,
} from "@/components/admin/trips/use-trip-options";
import { SelectField } from "@/components/forms/select-field";
import { SwitchField } from "@/components/forms/switch-field";
import { TextField } from "@/components/forms/text-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldError, FieldGroup, FieldLegend, FieldSet } from "@/components/ui/field";
import type { AdminTripSchedule, TripSchedulePayload } from "@/lib/api/admin-types";
import { WEEKDAYS, formatDay } from "@/lib/datetime";
import { formatCurrency, formatDuration, pluralize, todayInSriLanka } from "@/lib/format";
import { applyApiErrors } from "@/lib/forms";
import {
  RECURRENCES,
  scheduleFormDefaults,
  scheduleSchema,
  toSchedulePayload,
  type ScheduleFormValues,
} from "@/lib/validations/trips";

const FIELDS = [
  "route",
  "bus",
  "departure_time",
  "base_price",
  "recurrence",
  "weekdays",
  "start_date",
  "end_date",
  "active",
] as const;

function WeekdayPicker({ control }: { control: Control<ScheduleFormValues> }) {
  return (
    <Controller
      control={control}
      name="weekdays"
      render={({ field, fieldState }) => {
        const selected = new Set(field.value);
        return (
          <FieldSet>
            <FieldLegend variant="label">Runs on</FieldLegend>
            <div role="group" aria-label="Weekdays" className="flex flex-wrap gap-2">
              {WEEKDAYS.map((day) => {
                const on = selected.has(day.value);
                return (
                  <Button
                    key={day.value}
                    type="button"
                    size="lg"
                    variant={on ? "default" : "outline"}
                    aria-pressed={on}
                    aria-label={day.long}
                    className="w-14"
                    onClick={() => {
                      const next = new Set(selected);
                      if (on) next.delete(day.value);
                      else next.add(day.value);
                      field.onChange([...next].sort((a, b) => a - b));
                    }}
                  >
                    {day.short}
                  </Button>
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

export function ScheduleForm({
  schedule,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  schedule?: AdminTripSchedule;
  submitLabel: string;
  onSubmit: (payload: TripSchedulePayload) => Promise<unknown>;
  onCancel?: () => void;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const routes = useRouteOptions();
  const buses = useBusOptions();
  const form = useForm<ScheduleFormValues>({
    resolver: zodResolver(scheduleSchema),
    defaultValues: scheduleFormDefaults(schedule, todayInSriLanka()),
  });
  const [routeId, busId, recurrence, weekdays, departureTime, startDate, endDate] = useWatch({
    control: form.control,
    name: ["route", "bus", "recurrence", "weekdays", "departure_time", "start_date", "end_date"],
  });

  const routeList = routes.data?.results ?? [];
  const busList = buses.data?.results ?? [];
  const selectedRoute = routeList.find((route) => route.id === routeId);
  const selectedBus =
    busList.find((bus) => bus.id === busId) ??
    (schedule?.bus === busId ? schedule.bus_summary : undefined);
  const routeFare =
    selectedRoute?.base_fare ?? (schedule?.route === routeId ? schedule.route_summary.base_fare : null);

  const days =
    recurrence === "daily"
      ? "every day"
      : weekdays.length > 0
        ? `every ${weekdays.map((day) => WEEKDAYS[day].long).join(", ")}`
        : null;
  const summary =
    days && /^\d{2}:\d{2}$/.test(departureTime) && /^\d{4}-\d{2}-\d{2}$/.test(startDate)
      ? `Runs ${days} at ${departureTime}, from ${formatDay(startDate)}${endDate ? ` until ${formatDay(endDate)}` : ""}.`
      : null;

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await onSubmit(toSchedulePayload(values));
    } catch (error) {
      setFormError(applyApiErrors(error, form.setError, FIELDS));
    }
  });

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <FormErrorAlert messages={formError ? [formError] : []} />
      <Card>
        <CardHeader>
          <CardTitle>Service</CardTitle>
          <CardDescription>The route and the bus that runs it every time.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup className="grid gap-5 md:grid-cols-2">
            <SelectField
              control={form.control}
              name="route"
              label="Route"
              placeholder={routes.isPending ? "Loading routes…" : "Choose a route"}
              options={routeSelectOptions(routeList, schedule?.route_summary)}
              onValueChange={(id) => {
                if (schedule || form.getFieldState("base_price").isDirty) return;
                form.setValue("base_price", routeList.find((route) => route.id === id)?.base_fare ?? "");
              }}
              description={
                selectedRoute
                  ? `${selectedRoute.origin.name} → ${selectedRoute.destination.name} · ${formatDuration(selectedRoute.duration_minutes) ?? "no timetable"}`
                  : "Only active routes with a stop timetable can be scheduled."
              }
            />
            <SelectField
              control={form.control}
              name="bus"
              label="Bus"
              placeholder={buses.isPending ? "Loading buses…" : "Choose a bus"}
              options={busSelectOptions(busList, schedule?.bus_summary)}
              description={
                selectedBus
                  ? `${pluralize(selectedBus.seat_capacity, "seat")} · ${selectedBus.seat_layout_name ?? "no seat layout"}`
                  : "Active buses with a seat layout, run by an approved operator."
              }
            />
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Timetable</CardTitle>
          <CardDescription>
            When the service runs. Editing a schedule never changes trips it has already
            generated.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <FieldGroup className="grid gap-5 md:grid-cols-3">
            <TextField
              control={form.control}
              name="departure_time"
              label="Departure time"
              type="time"
              description="Sri Lanka time, 24-hour."
            />
            <TextField
              control={form.control}
              name="base_price"
              label="Ticket price (LKR)"
              inputMode="decimal"
              placeholder={routeFare ?? "2500"}
              description={routeFare ? `Route standard fare: ${formatCurrency(routeFare)}.` : "Price per seat."}
            />
            <SelectField
              control={form.control}
              name="recurrence"
              label="Repeats"
              options={RECURRENCES.map((option) => ({ ...option }))}
            />
          </FieldGroup>
          {recurrence === "weekly" && <WeekdayPicker control={form.control} />}
          <FieldGroup className="grid gap-5 md:grid-cols-2">
            <TextField control={form.control} name="start_date" label="First day" type="date" />
            <TextField
              control={form.control}
              name="end_date"
              label="Last day"
              type="date"
              description="Optional. Leave empty to keep the schedule running."
            />
          </FieldGroup>
          {summary && (
            <p className="rounded-xl bg-muted/60 px-4 py-3 text-sm" aria-live="polite">
              {summary}
            </p>
          )}
          <SwitchField
            control={form.control}
            name="active"
            label="Active"
            description="Inactive schedules can’t generate new trips."
          />
        </CardContent>
      </Card>

      <FormActions submitLabel={submitLabel} pending={form.formState.isSubmitting} onCancel={onCancel} />
    </form>
  );
}
