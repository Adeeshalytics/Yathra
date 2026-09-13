import L from "leaflet";

import type { StopRole } from "@/lib/map";

/**
 * Map pins, drawn as SVG.
 *
 * Leaflet's stock icon is a PNG resolved relative to the CSS file, which bundlers famously
 * break. Drawing the pins ourselves avoids that entirely, keeps them crisp on any screen, and
 * lets origin, destination and the customer's own choices read differently at a glance.
 */

const COLOURS = {
  origin: "#059669", // emerald: where the journey starts
  intermediate: "#2563eb", // blue: everywhere it calls on the way
  destination: "#dc2626", // red: where it ends
  selected: "#b45309", // amber: this traveller's boarding / drop-off point
  bus: "#0f6f68", // brand teal: reserved for the live vehicle
} as const;

export type MarkerLook = StopRole | "selected";

function pin(colour: string, label: string, emphasised: boolean): string {
  const size = emphasised ? 40 : 32;
  const ring = emphasised
    ? `<circle cx="12" cy="12" r="11" fill="none" stroke="${colour}" stroke-opacity="0.35" stroke-width="6"/>`
    : "";
  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 34" width="${size}" height="${size * 1.4}" aria-hidden="true">
      ${ring}
      <path d="M12 33.5C12 33.5 22.5 20.8 22.5 12.4A10.5 10.5 0 1 0 1.5 12.4C1.5 20.8 12 33.5 12 33.5Z"
            fill="${colour}" stroke="white" stroke-width="1.75" stroke-linejoin="round"/>
      <circle cx="12" cy="12" r="6.5" fill="white"/>
      <text x="12" y="15.4" text-anchor="middle" font-size="8.5" font-weight="700"
            font-family="system-ui, sans-serif" fill="${colour}">${label}</text>
    </svg>`;
}

/** A numbered pin for one stop. `sequence` is what the traveller sees on the timeline. */
export function stopIcon(look: MarkerLook, sequence: number): L.DivIcon {
  const emphasised = look === "selected";
  const size = emphasised ? 40 : 32;
  return L.divIcon({
    html: pin(COLOURS[look], String(sequence), emphasised),
    className: "yathra-stop-marker",
    iconSize: [size, size * 1.4],
    iconAnchor: [size / 2, size * 1.4],
    popupAnchor: [0, -size * 1.25],
  });
}

/**
 * The vehicle itself. Nothing renders this yet — live tracking is a later phase — but the
 * marker exists so that phase is a data change rather than a design change.
 */
export function busIcon(): L.DivIcon {
  return L.divIcon({
    html: `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
        <circle cx="12" cy="12" r="11" fill="${COLOURS.bus}" stroke="white" stroke-width="2"/>
        <path d="M7.5 7h9v7.5h-9zM8 15v1.5M16 15v1.5" fill="none" stroke="white" stroke-width="1.5"
              stroke-linecap="round"/>
        <path d="M8.5 8.5h7v3h-7z" fill="white" fill-opacity="0.9"/>
      </svg>`,
    className: "yathra-bus-marker",
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -16],
  });
}

export const MARKER_COLOURS = COLOURS;
