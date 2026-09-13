"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { FormActions, FormErrorAlert } from "@/components/admin/shared/page-parts";
import { SwitchField } from "@/components/forms/switch-field";
import { TextField } from "@/components/forms/text-field";
import { TextareaField } from "@/components/forms/textarea-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import type { AdminRouteDetail, RoutePayload } from "@/lib/api/admin-types";
import { applyApiErrors, fieldErrorList } from "@/lib/forms";
import { routeSchema, toRoutePayload, type RouteFormValues } from "@/lib/validations/admin";

import { RouteMapPreview } from "./route-map-preview";
import { RouteStopsEditor } from "./route-stops-editor";

const FIELDS = ["name", "route_number", "description", "base_fare", "active"] as const;

export function RouteForm({
  route,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  route?: AdminRouteDetail;
  submitLabel: string;
  onSubmit: (payload: RoutePayload) => Promise<unknown>;
  onCancel?: () => void;
}) {
  const [errors, setErrors] = useState<string[]>([]);
  const form = useForm<RouteFormValues>({
    resolver: zodResolver(routeSchema),
    defaultValues: {
      name: route?.name ?? "",
      route_number: route?.route_number ?? "",
      description: route?.description ?? "",
      base_fare: route?.base_fare ?? "",
      active: route?.active ?? true,
      stops:
        route?.stops.map((stop) => ({
          stop: stop.stop,
          arrival: String(stop.arrival_offset_minutes),
          departure: String(stop.departure_offset_minutes),
          boarding: stop.is_boarding_point,
          dropoff: stop.is_dropoff_point,
        })) ?? [],
    },
  });

  const name = useWatch({ control: form.control, name: "name" });
  const stops = useWatch({ control: form.control, name: "stops" }) ?? [];
  const suggestion =
    stops.length >= 2 ? `${stops[0].stop.city} – ${stops[stops.length - 1].stop.city}` : null;

  const submit = form.handleSubmit(async (values) => {
    setErrors([]);
    try {
      await onSubmit(toRoutePayload(values));
    } catch (error) {
      const banner = applyApiErrors(error, form.setError, FIELDS);
      const stopErrors = fieldErrorList(error, "stops");
      setErrors(stopErrors.length > 0 ? stopErrors : banner ? [banner] : []);
    }
  });

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <FormErrorAlert messages={errors} />
      <Card>
        <CardHeader>
          <CardTitle>Route details</CardTitle>
          <CardDescription>How the route appears to passengers and operators.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup className="grid gap-5 md:grid-cols-2">
            <div className="space-y-1.5">
              <TextField control={form.control} name="name" label="Route name" placeholder="Colombo – Kandy" />
              {suggestion && name.trim() !== suggestion && (
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0 text-xs"
                  onClick={() => form.setValue("name", suggestion, { shouldValidate: true })}
                >
                  Use “{suggestion}”
                </Button>
              )}
            </div>
            <TextField
              control={form.control}
              name="route_number"
              label="Route number (optional)"
              placeholder="01"
              className="uppercase"
            />
            <TextField
              control={form.control}
              name="base_fare"
              label="Standard fare, LKR (optional)"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              placeholder="790.00"
              description="Full-journey fare. Trips can override it."
            />
            <SwitchField
              control={form.control}
              name="active"
              label="Active"
              description="Inactive routes are hidden from passengers."
            />
            <div className="md:col-span-2">
              <TextareaField
                control={form.control}
                name="description"
                label="Description (optional)"
                rows={2}
                placeholder="Via Kadawatha and Kegalle."
              />
            </div>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stops &amp; timetable</CardTitle>
          <CardDescription>
            List every stop in travel order. Times are minutes after the bus leaves the origin.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RouteStopsEditor form={form} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Route map</CardTitle>
          <CardDescription>
            The line follows the stops in the order above. It redraws as you reorder them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RouteMapPreview form={form} />
        </CardContent>
      </Card>

      <FormActions submitLabel={submitLabel} pending={form.formState.isSubmitting} onCancel={onCancel} />
    </form>
  );
}
