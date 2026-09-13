"use client";

import { MapPinOffIcon } from "lucide-react";
import dynamic from "next/dynamic";

import { EmptyState } from "@/components/common/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { describePath, type RouteGeometry } from "@/lib/map";
import { pluralize } from "@/lib/format";

import type { RouteMapProps } from "./route-map";

/**
 * Leaflet reads `window` as it loads, so the map is imported in the browser only and never
 * rendered on the server. This wrapper is what the rest of the app uses: it keeps the map out
 * of every page that does not show one, and answers for the two states a map cannot —
 * "still loading" and "nobody has mapped these stops yet".
 */
const Map = dynamic(() => import("./route-map").then((module) => module.RouteMap), {
  ssr: false,
  loading: () => <Skeleton className="h-72 w-full rounded-xl sm:h-96" />,
});

export interface RouteMapPanelProps extends RouteMapProps {
  /** Shown when no stop on the journey has coordinates yet. */
  emptyDescription?: string;
}

export function RouteMapPanel({
  geometry,
  emptyDescription = "None of these stops has been placed on the map yet. An administrator can add coordinates to each stop.",
  ...props
}: RouteMapPanelProps) {
  const path = describePath(props.roadPath);
  if (geometry.stops.length === 0) {
    return (
      <EmptyState
        icon={MapPinOffIcon}
        title="No map for this route yet"
        description={emptyDescription}
      />
    );
  }

  return (
    <div className="space-y-2">
      <Map geometry={geometry} {...props} />
      <PathNotice kind={path.kind} kilometres={path.kilometres} />
      {geometry.unmapped.length > 0 && <UnmappedNotice geometry={geometry} />}
    </div>
  );
}

/**
 * Half a route is still worth drawing — but say so, rather than letting the line quietly skip
 * a town.
 */
function UnmappedNotice({ geometry }: { geometry: RouteGeometry }) {
  const names = geometry.unmapped.map((stop) => stop.name);
  return (
    <p className="text-xs text-muted-foreground print:hidden">
      {pluralize(names.length, "stop")} on this route {names.length === 1 ? "is" : "are"} not on
      the map yet ({names.join(", ")}), so the line skips {names.length === 1 ? "it" : "them"}.
    </p>
  );
}


/**
 * Say what the line is. A road route is the journey; a straight line is only the order of the
 * stops, and a traveller reading distances off the map deserves to know which they are looking at.
 */
function PathNotice({ kind, kilometres }: { kind: "road" | "direct"; kilometres: number | null }) {
  if (kind === "road") {
    return (
      <p className="text-xs text-muted-foreground print:hidden">
        Following the road{kilometres ? ` · about ${Math.round(kilometres)} km` : ""}.
      </p>
    );
  }
  return (
    <p className="text-xs text-muted-foreground print:hidden">
      The dashed line joins the stops in order — the road route for this journey hasn’t been
      worked out yet.
    </p>
  );
}
