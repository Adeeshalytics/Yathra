"use client";

import {
  ArrowDownIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  GripVerticalIcon,
  RouteIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";
import { Controller, useFieldArray, useWatch, type UseFormReturn } from "react-hook-form";

import { EmptyState } from "@/components/common/empty-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { StopBrief } from "@/lib/api/admin-types";
import { formatOffset } from "@/lib/format";
import { cn } from "@/lib/utils";
import { newRouteStop, type RouteFormValues } from "@/lib/validations/admin";

import { StopPicker } from "./stop-picker";

type OffsetField = "arrival" | "departure";

/**
 * Ordered stop list for a route. The first row is always the origin and the last the
 * destination. Rows can be dragged by their handle or moved with the arrow buttons.
 */
export function RouteStopsEditor({ form }: { form: UseFormReturn<RouteFormValues> }) {
  const { fields, append, insert, move, remove } = useFieldArray({
    control: form.control,
    name: "stops",
    keyName: "key",
  });
  const stops = useWatch({ control: form.control, name: "stops" }) ?? [];
  const [armedIndex, setArmedIndex] = useState<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const stopErrors = form.formState.errors.stops;
  const listError = stopErrors?.root?.message ?? stopErrors?.message;
  const last = fields.length - 1;

  const revalidate = () => {
    if (form.formState.isSubmitted) void form.trigger("stops");
  };

  // Offsets are measured from the origin's departure, so the origin is always 0 / 0.
  const pinOrigin = () => {
    if (form.getValues("stops").length > 0) {
      form.setValue("stops.0.arrival", "0");
      form.setValue("stops.0.departure", "0");
      form.setValue("stops.0.boarding", true);
    }
  };

  const reorder = (from: number, to: number) => {
    if (to < 0 || to > last || from === to) return;
    move(from, to);
    pinOrigin();
    revalidate();
  };

  const addStop = (stop: StopBrief) => {
    const current = form.getValues("stops");
    if (current.length < 2) {
      append(newRouteStop(stop, current.at(-1)));
    } else {
      // New stops go before the destination, timed halfway between its neighbours.
      const before = current[current.length - 2];
      const destination = current[current.length - 1];
      const row = newRouteStop(stop, before);
      const leaves = Number(before.departure) || 0;
      const arrives = Number(destination.arrival) || 0;
      if (arrives - leaves >= 2) {
        const middle = String(leaves + Math.floor((arrives - leaves) / 2));
        row.arrival = middle;
        row.departure = middle;
      }
      insert(current.length - 1, row);
    }
    revalidate();
  };

  const renderOffset = (index: number, field: OffsetField, label: string) => (
    <Controller
      control={form.control}
      name={`stops.${index}.${field}`}
      render={({ field: input, fieldState }) => {
        const id = `stop-${index}-${field}`;
        const minutes = /^\d+$/.test(input.value) ? Number(input.value) : null;
        return (
          <div className="space-y-1.5">
            <Label htmlFor={id} className="text-xs text-muted-foreground">
              {label}
            </Label>
            <div className="relative">
              <Input
                {...input}
                id={id}
                type="number"
                inputMode="numeric"
                min={0}
                disabled={index === 0}
                onChange={(event) => {
                  input.onChange(event.target.value);
                  revalidate();
                }}
                aria-invalid={fieldState.invalid}
                aria-describedby={fieldState.invalid ? `${id}-error` : `${id}-hint`}
                className="h-10 pr-14 tabular-nums"
              />
              <span
                id={`${id}-hint`}
                className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground tabular-nums"
              >
                {minutes === null ? "min" : formatOffset(minutes)}
              </span>
            </div>
            {fieldState.error && (
              <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
                {fieldState.error.message}
              </p>
            )}
          </div>
        );
      }}
    />
  );

  const renderFlag = (index: number, field: "boarding" | "dropoff", label: string) => (
    <Controller
      control={form.control}
      name={`stops.${index}.${field}`}
      render={({ field: input, fieldState }) => {
        const id = `stop-${index}-${field}`;
        return (
          <div className="space-y-1">
            <div className="flex h-10 items-center gap-2">
              <Checkbox
                id={id}
                checked={input.value}
                onCheckedChange={(checked) => {
                  input.onChange(checked === true);
                  revalidate();
                }}
                aria-invalid={fieldState.invalid}
              />
              <Label htmlFor={id} className="font-normal">
                {label}
              </Label>
            </div>
            {fieldState.error && (
              <p role="alert" className="text-xs text-destructive">
                {fieldState.error.message}
              </p>
            )}
          </div>
        );
      }}
    />
  );

  const origin = stops[0]?.stop;
  const destination = stops.length > 1 ? stops[stops.length - 1] : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {origin ? (
            <>
              <span className="font-semibold">{origin.name}</span>
              <ArrowRightIcon className="size-4 text-muted-foreground" aria-label="to" />
              <span className="font-semibold">{destination?.stop.name ?? "…"}</span>
              {destination && /^\d+$/.test(destination.arrival) && (
                <Badge variant="secondary">{formatOffset(Number(destination.arrival)).slice(1)} h journey</Badge>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">Start with the origin stop.</span>
          )}
        </div>
        <StopPicker
          excludeIds={stops.map((row) => row.stop.id)}
          onSelect={addStop}
          label={fields.length === 0 ? "Add origin" : fields.length === 1 ? "Add destination" : "Add stop"}
        />
      </div>

      {listError && (
        <Alert variant="destructive" className="bg-destructive/5">
          <TriangleAlertIcon />
          <AlertDescription>{listError}</AlertDescription>
        </Alert>
      )}

      {fields.length === 0 ? (
        <EmptyState
          icon={RouteIcon}
          title="No stops yet"
          description="Add the origin, then the destination, then any stops in between. Times are minutes after the bus leaves the origin."
        />
      ) : (
        <ol className="space-y-2" aria-label="Route stops in order">
          {fields.map((field, index) => {
            const row = stops[index] ?? field;
            const stopError = stopErrors?.[index]?.stop?.message;
            const role = index === 0 ? "Origin" : index === last ? "Destination" : `Stop ${index + 1}`;
            return (
              <li
                key={field.key}
                draggable={armedIndex === index}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  setDragIndex(index);
                }}
                onDragOver={(event) => {
                  if (dragIndex === null) return;
                  event.preventDefault();
                  setOverIndex(index);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragIndex !== null) reorder(dragIndex, index);
                  setDragIndex(null);
                  setOverIndex(null);
                  setArmedIndex(null);
                }}
                onDragEnd={() => {
                  setDragIndex(null);
                  setOverIndex(null);
                  setArmedIndex(null);
                }}
                className={cn(
                  "rounded-xl border bg-card p-3 transition-colors sm:p-4",
                  dragIndex === index && "opacity-50",
                  overIndex === index && dragIndex !== index && "border-primary bg-primary/5",
                )}
              >
                <div className="flex items-start gap-2 sm:gap-3">
                  <span
                    onPointerDown={() => setArmedIndex(index)}
                    onPointerUp={() => setArmedIndex(null)}
                    className="mt-1 hidden cursor-grab text-muted-foreground active:cursor-grabbing sm:block"
                    title="Drag to reorder"
                    aria-hidden
                  >
                    <GripVerticalIcon className="size-5" />
                  </span>
                  <span
                    className={cn(
                      "grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold",
                      index === 0 || index === last
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-secondary-foreground",
                    )}
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      <span className="truncate">{row.stop.name}</span>
                      {row.stop.city !== row.stop.name && (
                        <span className="text-sm font-normal text-muted-foreground">{row.stop.city}</span>
                      )}
                      {!row.stop.active && <Badge variant="outline">Inactive stop</Badge>}
                    </p>
                    <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{role}</p>
                    {stopError && (
                      <p role="alert" className="mt-1 text-xs text-destructive">
                        {stopError}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => reorder(index, index - 1)}
                      disabled={index === 0}
                      aria-label={`Move ${row.stop.name} up`}
                    >
                      <ArrowUpIcon />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => reorder(index, index + 1)}
                      disabled={index === last}
                      aria-label={`Move ${row.stop.name} down`}
                    >
                      <ArrowDownIcon />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        remove(index);
                        if (index === 0) pinOrigin();
                        revalidate();
                      }}
                      aria-label={`Remove ${row.stop.name}`}
                    >
                      <XIcon />
                    </Button>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:pl-[4.25rem] lg:grid-cols-4">
                  {renderOffset(index, "arrival", "Arrives after")}
                  {renderOffset(index, "departure", "Departs after")}
                  {renderFlag(index, "boarding", "Boarding")}
                  {renderFlag(index, "dropoff", "Drop-off")}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
