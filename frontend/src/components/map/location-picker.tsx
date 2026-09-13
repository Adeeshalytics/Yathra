"use client";

import { MapPinIcon, XIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { positionOf, type LatLng } from "@/lib/map";

const PickerMap = dynamic(
  () => import("./location-picker-map").then((module) => module.LocationPickerMap),
  { ssr: false, loading: () => <Skeleton className="h-64 w-full rounded-xl sm:h-72" /> },
);

/** Six decimal places is roughly a tenth of a metre — far more than a bus stand needs. */
function round(value: number): string {
  return value.toFixed(6);
}

/**
 * Placing a stop on the map, as an alternative to typing its coordinates.
 *
 * The form's fields stay the source of truth: clicking the map fills them in, and typing into
 * them moves the marker. The map is hidden until it is asked for, so the admin form does not
 * pay for Leaflet unless someone wants it.
 */
export function LocationPicker({
  latitude,
  longitude,
  onPick,
  onClear,
  label = "Pick the stop’s location on the map",
}: {
  latitude: string;
  longitude: string;
  onPick: (coordinates: { latitude: string; longitude: string }) => void;
  onClear?: () => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const position: LatLng | null = positionOf({
    latitude: latitude || null,
    longitude: longitude || null,
  });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen((was) => !was)}>
          <MapPinIcon data-icon="inline-start" />
          {open ? "Hide map" : position ? "Move on map" : "Pick on map"}
        </Button>
        {position && onClear && (
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            <XIcon data-icon="inline-start" />
            Clear coordinates
          </Button>
        )}
        {position && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {position[0].toFixed(5)}, {position[1].toFixed(5)}
          </span>
        )}
      </div>

      {open && (
        <>
          <PickerMap
            position={position}
            label={label}
            onPick={([lat, lng]) => onPick({ latitude: round(lat), longitude: round(lng) })}
          />
          <p className="text-xs text-muted-foreground">
            Click the bus stand to place it. The latitude and longitude fields update as you
            click, and you can still type them by hand.
          </p>
        </>
      )}
    </div>
  );
}
