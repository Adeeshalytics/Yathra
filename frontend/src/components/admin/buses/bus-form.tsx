"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { FormActions, FormErrorAlert } from "@/components/admin/shared/page-parts";
import { CheckboxGroupField } from "@/components/forms/checkbox-group-field";
import { SelectField } from "@/components/forms/select-field";
import { SwitchField } from "@/components/forms/switch-field";
import { TextField } from "@/components/forms/text-field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { adminApi } from "@/lib/api/admin";
import type { AdminBus, BusFacility, BusPayload, BusType } from "@/lib/api/admin-types";
import { queryKeys } from "@/lib/api/query-keys";
import { applyApiErrors } from "@/lib/forms";
import {
  AIR_CONDITIONED_BUS_TYPES,
  BUS_FACILITIES,
  BUS_TYPES,
  busSchema,
  toBusPayload,
  type BusFormValues,
} from "@/lib/validations/admin";

import { FACILITY_ICONS } from "./facilities";

const FIELDS = [
  "operator",
  "registration_number",
  "name",
  "bus_type",
  "seat_capacity",
  "seat_layout",
  "facilities",
  "active",
] as const;

export const OPERATOR_OPTION_PARAMS = { page_size: 100, ordering: "company_name" };
export const LAYOUT_OPTION_PARAMS = { page_size: 100, ordering: "name" };

export function BusForm({
  bus,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  bus?: AdminBus;
  submitLabel: string;
  onSubmit: (payload: BusPayload) => Promise<unknown>;
  onCancel?: () => void;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const operators = useQuery({
    queryKey: queryKeys.admin.list("operators", OPERATOR_OPTION_PARAMS),
    queryFn: ({ signal }) => adminApi.operators.list(OPERATOR_OPTION_PARAMS, signal),
  });
  const layouts = useQuery({
    queryKey: queryKeys.admin.list("seat-layouts", LAYOUT_OPTION_PARAMS),
    queryFn: ({ signal }) => adminApi.seatLayouts.list(LAYOUT_OPTION_PARAMS, signal),
  });

  const form = useForm<BusFormValues>({
    resolver: zodResolver(busSchema),
    defaultValues: {
      operator: bus?.operator ?? "",
      registration_number: bus?.registration_number ?? "",
      name: bus?.name ?? "",
      bus_type: bus?.bus_type ?? "normal",
      seat_layout: bus?.seat_layout ?? "",
      seat_capacity: bus ? String(bus.seat_capacity) : "",
      facilities: bus?.facilities ?? [],
      active: bus?.active ?? true,
    },
  });

  const busType = useWatch({ control: form.control, name: "bus_type" }) as BusType;
  const layoutId = useWatch({ control: form.control, name: "seat_layout" });
  const layoutList = layouts.data?.results ?? [];
  const selectedLayout = layoutList.find((layout) => layout.id === layoutId);
  const acLocked = AIR_CONDITIONED_BUS_TYPES.includes(busType);

  const operatorOptions = (operators.data?.results ?? []).map((operator) => ({
    value: operator.id,
    label:
      operator.status === "suspended"
        ? `${operator.company_name} (suspended)`
        : operator.company_name,
    // Suspended operators can't receive buses, but keep the current one selectable.
    disabled: operator.status === "suspended" && operator.id !== bus?.operator,
  }));
  const layoutOptions = layoutList
    .filter((layout) => layout.active || layout.id === bus?.seat_layout)
    .map((layout) => ({
      value: layout.id,
      label: `${layout.name} · ${layout.bookable_seat_count} bookable seats`,
    }));

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    if (selectedLayout && Number(values.seat_capacity) > selectedLayout.bookable_seat_count) {
      form.setError("seat_capacity", {
        message: `The selected layout only has ${selectedLayout.bookable_seat_count} bookable seats.`,
      });
      return;
    }
    const facilities: BusFacility[] =
      acLocked && !values.facilities.includes("ac") ? ["ac", ...values.facilities] : values.facilities;
    try {
      await onSubmit(toBusPayload({ ...values, facilities }));
    } catch (error) {
      setFormError(applyApiErrors(error, form.setError, FIELDS));
    }
  });

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <FormErrorAlert messages={formError ? [formError] : []} />
      <Card>
        <CardHeader>
          <CardTitle>Bus details</CardTitle>
          <CardDescription>Who runs it and how passengers will recognise it.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup className="grid gap-5 md:grid-cols-2">
            <TextField
              control={form.control}
              name="name"
              label="Display name"
              placeholder="Hill Country Express"
            />
            <TextField
              control={form.control}
              name="registration_number"
              label="Registration number"
              placeholder="NB-1234"
              className="uppercase"
              autoComplete="off"
              description="Sri Lankan plate, optionally with the province, e.g. WP NB-1234."
            />
            <SelectField
              control={form.control}
              name="operator"
              label="Operator"
              placeholder={operators.isPending ? "Loading operators…" : "Choose an operator"}
              options={operatorOptions}
              disabled={operators.isPending}
            />
            <SelectField
              control={form.control}
              name="bus_type"
              label="Bus type"
              options={BUS_TYPES}
              onValueChange={(type) => {
                if (AIR_CONDITIONED_BUS_TYPES.includes(type as BusType)) {
                  const current = form.getValues("facilities");
                  if (!current.includes("ac")) form.setValue("facilities", ["ac", ...current]);
                }
              }}
            />
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Seating</CardTitle>
          <CardDescription>
            Pick a seat layout, then how many of its seats are sold on each trip.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup className="grid gap-5 md:grid-cols-2">
            <SelectField
              control={form.control}
              name="seat_layout"
              label="Seat layout"
              placeholder={layouts.isPending ? "Loading layouts…" : "Choose a layout"}
              emptyOptionLabel="No layout yet"
              options={layoutOptions}
              disabled={layouts.isPending}
              onValueChange={(id) => {
                const layout = layoutList.find((candidate) => candidate.id === id);
                if (layout) {
                  form.setValue("seat_capacity", String(layout.bookable_seat_count), {
                    shouldValidate: form.formState.isSubmitted,
                  });
                }
              }}
              description={
                selectedLayout ? (
                  <Link
                    href={`/admin/seat-layouts/${selectedLayout.id}`}
                    className="text-primary underline-offset-4 hover:underline"
                    target="_blank"
                  >
                    Preview this layout
                  </Link>
                ) : (
                  "Needed before the bus can be booked online."
                )
              }
            />
            <TextField
              control={form.control}
              name="seat_capacity"
              label="Seats for sale"
              type="number"
              inputMode="numeric"
              min={1}
              max={selectedLayout?.bookable_seat_count ?? 90}
              description={
                selectedLayout
                  ? `Up to ${selectedLayout.bookable_seat_count} for this layout.`
                  : "Between 1 and 90."
              }
            />
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Facilities</CardTitle>
          <CardDescription>Shown to passengers when they compare departures.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <CheckboxGroupField
            control={form.control}
            name="facilities"
            legend="On-board facilities"
            lockedValues={acLocked ? ["ac"] : []}
            description={acLocked ? "AC, Luxury and Super Luxury buses always include AC." : undefined}
            options={BUS_FACILITIES.map((facility) => {
              const Icon = FACILITY_ICONS[facility.value];
              return {
                value: facility.value,
                label: facility.label,
                icon: <Icon className="size-4 text-muted-foreground" />,
              };
            })}
          />
          <SwitchField
            control={form.control}
            name="active"
            label="Active"
            description="Inactive buses stay on record but can’t be scheduled."
          />
        </CardContent>
      </Card>

      <FormActions submitLabel={submitLabel} pending={form.formState.isSubmitting} onCancel={onCancel} />
    </form>
  );
}
