"use client";

import "leaflet/dist/leaflet.css";

import { useEffect, useMemo } from "react";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";

import { env } from "@/lib/env";
import { FALLBACK_CENTRE, FALLBACK_ZOOM, type LatLng } from "@/lib/map";

import { stopIcon } from "./marker-icons";

const PLACED_ZOOM = 15;

function ClickToPlace({ onPick }: { onPick: (position: LatLng) => void }) {
  useMapEvents({
    click: (event) => onPick([event.latlng.lat, event.latlng.lng]),
  });
  return null;
}

/** Follow the form: typing coordinates by hand moves the map, and vice versa. */
function FollowValue({ position }: { position: LatLng | null }) {
  const map = useMap();
  const key = position ? `${position[0]},${position[1]}` : "";

  useEffect(() => {
    if (!position) return;
    const current = map.getCenter();
    const moved =
      Math.abs(current.lat - position[0]) > 0.0005 ||
      Math.abs(current.lng - position[1]) > 0.0005;
    if (moved) map.setView(position, Math.max(map.getZoom(), PLACED_ZOOM));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => map.invalidateSize());
    return () => window.cancelAnimationFrame(frame);
  }, [map]);

  return null;
}

/**
 * Click the map to place a stop. Browser-only (Leaflet touches `window`), so it is reached
 * through `LocationPicker`, which also keeps it out of the bundle of every other page.
 */
export function LocationPickerMap({
  position,
  onPick,
  label,
  heightClassName = "h-64 sm:h-72",
}: {
  position: LatLng | null;
  onPick: (position: LatLng) => void;
  label: string;
  heightClassName?: string;
}) {
  const centre = useMemo(() => position ?? FALLBACK_CENTRE, [position]);

  return (
    <div className={`${heightClassName} w-full overflow-hidden rounded-xl border print:hidden`}>
      <MapContainer
        center={centre}
        zoom={position ? PLACED_ZOOM : FALLBACK_ZOOM}
        scrollWheelZoom={false}
        className="size-full"
        aria-label={label}
      >
        <TileLayer
          url={env.NEXT_PUBLIC_MAP_TILE_URL}
          attribution={env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION}
          maxZoom={19}
          detectRetina
        />
        <ClickToPlace onPick={onPick} />
        <FollowValue position={position} />
        {position && (
          <Marker position={position} icon={stopIcon("selected", 1)} title="This stop" />
        )}
      </MapContainer>
    </div>
  );
}
