"use client";

import { useWatch, type UseFormReturn } from "react-hook-form";

import { RouteMapPanel } from "@/components/map/route-map-panel";
import { geometryForStops } from "@/lib/map";
import type { RouteFormValues } from "@/lib/validations/admin";

/**
 * The route being edited, drawn as it is edited: adding, removing or reordering a stop redraws
 * the line straight away, because the map reads the same form state the list does.
 */
export function RouteMapPreview({ form }: { form: UseFormReturn<RouteFormValues> }) {
  const stops = useWatch({ control: form.control, name: "stops" }) ?? [];
  const geometry = geometryForStops(
    stops.map((row, index) => ({ stop: row.stop, sequence: index + 1 })),
    {
      boarding: (index) => stops[index]?.boarding ?? true,
      dropoff: (index) => stops[index]?.dropoff ?? true,
    },
  );

  return (
    <RouteMapPanel
      geometry={geometry}
      heightClassName="h-64 sm:h-80"
      emptyDescription="Add stops that have coordinates, or give the ones on this route a latitude and longitude, to see the line on a map."
    />
  );
}
