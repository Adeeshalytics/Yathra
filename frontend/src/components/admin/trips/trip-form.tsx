"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { RotateCcwIcon } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { FormActions, FormErrorAlert } from "@/components/admin/shared/page-parts";
import { SelectField } from "@/components/forms/select-field";
import { SwitchField } from "@/components/forms/switch-field";
import { TextField } from "@/components/forms/text-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { adminApi } from "@/lib/api/admin";
import type { AdminTripDetail, TripPayload } from "@/lib/api/admin-types";
import { ApiError, getErrorMessage } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";
import { addMinutes, formatTime, formatTripDate, sriLankaDateTime } from "@/lib/datetime";
import { formatCurrency, formatDuration, pluralize } from "@/lib/format";
import { applyApiErrors, fieldErrorList } from "@/lib/forms";
import {
  rowsFromRoute,
  toTripPayload,
  tripFormDefaults,
  tripSchema,
  type TripFormValues,
  type TripStopRow,
} from "@/lib/validations/trips";

import { TripStopsEditor } from "./trip-stops-editor";
import { busSelectOptions, routeSelectOptions, useBusOptions, useRouteOptions } from "./use-trip-options";

const FIELDS = ["route", "bus", "date", "time", "base_price", "active"] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

/** Read at submit time (outside render) — the API re-checks this anyway. */
function isInThePast(iso: string): boolean {
  return Date.parse(iso) <= Date.now();
}

export function TripForm({
  trip,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  trip?: AdminTripDetail;
  submitLabel: string;
  onSubmit: (payload: TripPayload) => Promise<unknown>;
  onCancel?: () => void;
}) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [serverStopErrors, setServerStopErrors] = useState<string[]>([]);
  const [loadingStops, setLoadingStops] = useState(false);
  const routes = useRouteOptions();
  const buses = useBusOptions();

  const form = useForm<TripFormValues>({
    resolver: zodResolver(tripSchema),
    defaultValues: tripFormDefaults(trip),
  });
  const [routeId, busId, date, time, rows] = useWatch({
    control: form.control,
    name: ["route", "bus", "date", "time", "stops"],
  });

  const routeList = routes.data?.results ?? [];
  const busList = buses.data?.results ?? [];
  const selectedRoute = routeList.find((route) => route.id === routeId);
  const selectedBus =
    busList.find((bus) => bus.id === busId) ?? (trip?.bus === busId ? trip.bus_summary : undefined);
  const routeFare =
    selectedRoute?.base_fare ?? (trip?.route === routeId ? trip.route_summary.base_fare : null);

  /** Replace the stop rows with the route's timetable (and default the price to its fare). */
  async function loadTimetable(id: string) {
    if (!id) return;
    setLoadingStops(true);
    setServerStopErrors([]);
    try {
      const route = await queryClient.fetchQuery({
        queryKey: queryKeys.admin.detail("routes", id),
        queryFn: ({ signal }) => adminApi.routes.get(id, signal),
      });
      if (form.getValues("route") !== id) return; // the admin already picked another route
      form.setValue("stops", rowsFromRoute(route), {
        shouldDirty: true,
        shouldValidate: form.formState.isSubmitted,
      });
      if (!trip && !form.getFieldState("base_price").isDirty) {
        form.setValue("base_price", route.base_fare ?? "");
      }
    } catch (error) {
      setFormError(getErrorMessage(error));
    } finally {
      setLoadingStops(false);
    }
  }

  function setRows(next: TripStopRow[]) {
    form.setValue("stops", next, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
    setServerStopErrors([]);
  }

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    setServerStopErrors([]);
    const departure = sriLankaDateTime(values.date, values.time);
    const moved = !trip || Date.parse(departure) !== Date.parse(trip.departure_datetime);
    if (moved && isInThePast(departure)) {
      form.setError("time", { message: "Choose a departure time in the future." }, { shouldFocus: true });
      return;
    }
    try {
      await onSubmit(toTripPayload(values));
    } catch (error) {
      const details = error instanceof ApiError ? error.fieldErrors : {};
      if (details.departure_datetime) {
        form.setError("time", { type: "server", message: details.departure_datetime });
      }
      const stopProblems = fieldErrorList(error, "stops");
      setServerStopErrors(stopProblems);
      const message = applyApiErrors(error, form.setError, FIELDS);
      const explained = Boolean(details.departure_datetime) || stopProblems.length > 0;
      setFormError(explained ? (details.non_field_errors ?? null) : message);
    }
  });

  const stopErrors = form.formState.errors.stops;
  const stopsMessage = stopErrors?.root?.message ?? stopErrors?.message;
  const lastRow = rows.at(-1);
  const arrival =
    DATE.test(date) && TIME.test(time) && lastRow && rows.length > 1
      ? addMinutes(sriLankaDateTime(date, time), lastRow.arrival)
      : null;

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <FormErrorAlert messages={formError ? [formError] : []} />
      <Card>
        <CardHeader>
          <CardTitle>Route & bus</CardTitle>
          <CardDescription>Which journey runs, and the vehicle that runs it.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup className="grid gap-5 md:grid-cols-2">
            <SelectField
              control={form.control}
              name="route"
              label="Route"
              placeholder={routes.isPending ? "Loading routes…" : "Choose a route"}
              options={routeSelectOptions(routeList, trip?.route_summary)}
              onValueChange={(id) => void loadTimetable(id)}
              description={
                selectedRoute
                  ? `${selectedRoute.origin.name} → ${selectedRoute.destination.name} · ${pluralize(selectedRoute.stop_count, "stop")}`
                  : "Only active routes with a stop timetable can be scheduled."
              }
            />
            <SelectField
              control={form.control}
              name="bus"
              label="Bus"
              placeholder={buses.isPending ? "Loading buses…" : "Choose a bus"}
              options={busSelectOptions(busList, trip?.bus_summary)}
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
          <CardTitle>Departure & price</CardTitle>
          <CardDescription>When the bus leaves the origin, in Sri Lanka time.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <FieldGroup className="grid gap-5 md:grid-cols-3">
            <TextField control={form.control} name="date" label="Departure date" type="date" />
            <TextField
              control={form.control}
              name="time"
              label="Departure time"
              type="time"
              description="24-hour clock, e.g. 20:30."
            />
            <TextField
              control={form.control}
              name="base_price"
              label="Ticket price (LKR)"
              inputMode="decimal"
              placeholder={routeFare ?? "2500"}
              description={
                routeFare
                  ? `Route standard fare: ${formatCurrency(routeFare)}.`
                  : "Price per seat, in rupees."
              }
            />
          </FieldGroup>
          <SwitchField
            control={form.control}
            name="active"
            label="On sale"
            description="Trips that are off sale stay on the timetable, but passengers can’t find them."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stop timings</CardTitle>
          <CardDescription>
            Estimated arrival and departure at each stop. Times after midnight roll over to the
            next day automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {rows.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {arrival && lastRow ? (
                  <>
                    Arrives{" "}
                    <span className="font-medium text-foreground">
                      {formatTripDate(arrival)} at {formatTime(arrival)}
                    </span>{" "}
                    · {formatDuration(lastRow.arrival)} journey
                  </>
                ) : (
                  "Set the departure date and time to see the clock times."
                )}
              </p>
              <Button
                type="button"
                variant="outline"
                size="lg"
                disabled={loadingStops || !routeId}
                onClick={() => void loadTimetable(routeId)}
              >
                <RotateCcwIcon data-icon="inline-start" />
                Use route timetable
              </Button>
            </div>
          )}
          <FormErrorAlert messages={[...(stopsMessage ? [stopsMessage] : []), ...serverStopErrors]} />
          {loadingStops ? (
            <Skeleton className="h-48 w-full rounded-xl" />
          ) : rows.length === 0 ? (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              Choose a route to load its stops.
            </p>
          ) : (
            <TripStopsEditor
              rows={rows}
              departureTime={TIME.test(time) ? time : ""}
              onChange={setRows}
              errorFor={(index, field) => stopErrors?.[index]?.[field]?.message}
            />
          )}
        </CardContent>
      </Card>

      <FormActions submitLabel={submitLabel} pending={form.formState.isSubmitting} onCancel={onCancel} />
    </form>
  );
}
