# Route maps

An interactive map of a bus route — origin, every intermediate stop, destination, the line
between them, and the traveller's own boarding and drop-off points — on the customer's trip page
and in the admin console.

This is the specification as built, including the decisions that changed along the way.

---

## What is on the map

| Element | How it looks |
|---------|--------------|
| Origin | Green numbered pin |
| Intermediate stops | Blue numbered pins |
| Destination | Red numbered pin |
| The traveller's boarding / drop-off point | Amber pin with a halo |
| The route | The road the bus drives, solid and blue (dashed when it has not been routed yet) |
| The bus (later) | Teal circle marker — the component accepts it, nothing supplies it yet |

Clicking a pin shows the stop's name, its city, its position on the route, the estimated arrival
and departure times, whether the bus picks up and sets down there, and — when the trip page is
showing it — buttons to board or get off at that stop.

The map fits itself to the whole route on load and whenever the route changes.

## Technology

**Leaflet 1.9 with react-leaflet 5** (which targets React 19, the version this app is on) and
**OpenStreetMap** tiles.

The tile server is configuration, not code:

```
NEXT_PUBLIC_MAP_TILE_URL=https://tile.openstreetmap.org/{z}/{x}/{y}.png
NEXT_PUBLIC_MAP_TILE_ATTRIBUTION=&copy; <a href="…">OpenStreetMap</a> contributors
```

OpenStreetMap's own servers are free, and their
[tile usage policy](https://operations.osmfoundation.org/policies/tiles/) asks that heavy or
commercial traffic move to a provider or a self-hosted server. When that day comes, it is these
two variables and the tile host in the Content-Security-Policy (`next.config.ts`), and nothing
else. Attribution is rendered by Leaflet on every map — it is a licence condition, not decoration.

## The line is the road

Buses follow roads, so the line on the map is the road — not a bearing between stops.

**OSRM** works it out. OSRM is OpenStreetMap's own routing engine, so the roads it returns are
the roads the tiles draw. The geometry comes back as an encoded polyline, which the backend
stores on the route and every map decodes (`decodePolyline` in `src/lib/map.ts`).

It is worked out **once per route, on the server** — never in the browser, and never while a
customer is waiting:

| When | What happens |
|------|--------------|
| A route is created, or its stops change | The stored path is dropped and a new one fetched after the change commits |
| A stop's coordinates change | Every route through that stop loses its path |
| `python manage.py refresh_route_paths` | Fills in any route with no path (`--force` re-fetches all) |

That design has three consequences worth knowing. Drawing a map costs no routing traffic at all,
so a public OSRM instance is never hammered. A routing service that is slow or down cannot slow
down — or break — route editing, because the fetch happens after the transaction commits and its
failure is only logged. And a path is never shown against stops it was not worked out for: a stale path
is deleted rather than drawn, which is why the fallback still exists.

**The fallback.** With no stored path the map joins the stops with a **dashed, thinner line** and
says so underneath: *"The dashed line joins the stops in order — the road route for this journey
hasn't been worked out yet."* A road route is drawn solid, with its distance: *"Following the
road · about 312 km."* The difference is deliberate — a straight line is a guess, and the map
should not pass a guess off as a route.

### Configuring it

```
ROUTING_SERVICE_URL=https://router.project-osrm.org   # development only
ROUTING_SERVICE_PROFILE=driving
ROUTING_SERVICE_TIMEOUT_SECONDS=8
```

The public demo server is fine while developing but **is not licensed for production traffic**.
Because paths are cached, a production site needs very little capacity — one small container is
plenty:

```bash
# Sri Lanka extract, once (~70 MB)
wget https://download.geofabrik.de/asia/sri-lanka-latest.osm.pbf
docker run -t -v "$PWD:/data" osrm/osrm-backend osrm-extract -p /opt/car.lua /data/sri-lanka-latest.osm.pbf
docker run -t -v "$PWD:/data" osrm/osrm-backend osrm-partition /data/sri-lanka-latest.osrm
docker run -t -v "$PWD:/data" osrm/osrm-backend osrm-customize /data/sri-lanka-latest.osrm

# Then serve it
docker run -d -p 5000:5000 -v "$PWD:/data" osrm/osrm-backend   osrm-routed --algorithm mld /data/sri-lanka-latest.osrm
```

…and point `ROUTING_SERVICE_URL` at `http://localhost:5000`. Re-run `refresh_route_paths --force`
after a map data update if you want the paths to follow new roads.

Nothing about this reaches the browser: the routing service is never contacted from the client,
so it needs no CSP entry and no public exposure.

## Data

`Stop` and `RouteStop` were already in the database from Phase 1; `Route` gained the cached road
path (migration `routes.0003_route_road_path`):

| `Route` | |
|---------|---|
| `path` | the road as an encoded polyline (precision 5), empty until routed |
| `path_distance_m`, `path_duration_s` | what the router measured |
| `path_source`, `path_updated_at` | which service answered, and when |

The stop fields, unchanged:

| `Stop` | `RouteStop` |
|--------|-------------|
| `id`, `name`, `city`, `active` | `id`, `route`, `stop`, `sequence` |
| `latitude`, `longitude` (nullable, both-or-neither, range-checked) | `arrival_offset`, `departure_offset` |
| | `is_boarding_point`, `is_dropoff_point` |

A check constraint keeps coordinates honest: either both are set and within ±90 / ±180, or both
are null. `sequence` is unique per route and decides travel order.

## API

**No new endpoint.** The original plan called for `GET /trips/{id}/route-map`, but the trip and
route endpoints already return stops in sequence with their times — they only lacked
coordinates. Adding two fields to the stop payload gives the map everything, keeps one source of
truth, and means the customer trip page draws its map with **no additional request**.

| Endpoint | What changed |
|----------|--------------|
| `GET /api/v1/trips/{id}/` | Each `stops[].stop` carries `latitude` and `longitude`; `route.road_path` carries the road |
| `GET /api/v1/trips/{id}/stops/` | Same, on the boarding and drop-off pickers |
| `GET /api/v1/routes/{id}/` | Already carried them |
| `GET /api/v1/admin/routes/{id}/` | Each `stops[].stop` now carries them, plus `road_path` |

```jsonc
{
  "sequence": 1,
  "stop": {
    "id": "83caeedc-…",
    "name": "Colombo Fort",
    "city": "Colombo",
    "latitude": "6.933600",   // decimal strings, or null
    "longitude": "79.850000"
  },
  "arrival_datetime": "2026-09-20T20:30:00+05:30",   // ISO instants, as everywhere else
  "departure_datetime": "2026-09-20T20:30:00+05:30",
  "is_boarding_point": true,
  "is_dropoff_point": false
}
```

The road itself rides on the route:

```jsonc
"road_path": {
  "geometry": "igii@sujfNGvAAHELELILIFUNClAA\?…",  // encoded polyline
  "precision": 5,                                   // decimal places (~1 m)
  "distance_m": 312004,
  "duration_s": 24180,
  "source": "router.project-osrm.org",
  "updated_at": "2026-09-12T09:41:07+05:30"
}
```

`null` until a routing service has answered — that is the signal for the dashed fallback.

Times stay ISO instants rather than the `"20:30"` strings the first draft proposed: the app
formats them in Asia/Colombo, and a bare clock string cannot survive a journey that crosses
midnight.

## Components

```tsx
<RouteMapPanel
  geometry={geometryForTrip(trip.stops)}
  boardingStopId={…}
  dropoffStopId={…}
  selectableBoardingIds={…}   // straight from the server's boarding_points
  selectableDropoffIds={…}
  onSelectBoarding={setBoardingId}
  onSelectDropoff={setDropoffId}
  busLocation={null}          // reserved for live tracking
/>
```

| File | Role |
|------|------|
| `lib/map.ts` | Turns API stops into map geometry. Pure, no Leaflet, fully tested. |
| `components/map/route-map.tsx` | The Leaflet map. Browser-only. |
| `components/map/route-map-panel.tsx` | What the app uses: dynamic import, loading skeleton, empty and partial states. |
| `components/map/marker-icons.ts` | SVG pins drawn in code. |
| `components/map/location-picker.tsx` | Click-to-place coordinates for the stop form. |

**Server rendering.** Leaflet reads `window` as it loads, so the map is imported through
`next/dynamic` with `ssr: false`. That also keeps it out of every page that has no map: Leaflet
lands in its own ~150 KB chunk (~45 KB compressed) that only the trip page, the route screens and
the stop form ever fetch.

**Partial data is the normal case.** A stop without coordinates is not dropped silently: the line
skips it and a line under the map names it. When no stop on a route is mapped, the panel says so
instead of showing an empty grey rectangle. An unmapped origin does not promote the second stop
to "origin" — the roles describe the journey, not the subset that happens to be mapped.

**Choosing from the map** is driven by the server's own `boarding_points` and `dropoff_points`,
so the map can only ever offer a journey the API would accept — a stop that has already departed,
or one before the chosen boarding point, has no button.

**Accessibility.** A Leaflet map is invisible to a screen reader. The textual stop list above the
map (`TripStopTimeline` for customers, the timetable for admins) is the accessible equivalent and
carries the same information: stop, order, times. The map is a labelled region beside it, never
the only way to get something done.

**Print.** Maps are `print:hidden`. Tickets and manifests print the list.

## Where it appears

**Customer — trip page (`/trips/{id}`).** A "Route map" card under the timetable, while the
traveller is choosing where to get on and off. Tapping a pin shows that stop's times and, where
the server allows it, boards or alights there. The map reflects the current selection.

**Admin — route form (`/admin/routes/new`, `/admin/routes/{id}/edit`).** A live preview under
the stop editor. Adding, removing or reordering a stop redraws the line immediately, because the
map reads the same form state the list does.

**Admin — route detail (`/admin/routes/{id}`).** The saved route, drawn beside its timetable.

**Admin — stop form.** **Pick on map** opens a picker; clicking fills in the latitude and
longitude to six decimal places. Typing coordinates by hand moves the marker. The map is hidden
until asked for.

There is no geocoding ("search for Kadawatha") in this phase: Nominatim's usage policy rules out
per-keystroke autocomplete, and a provider's geocoder is a decision for whenever the tile
provider changes.

## Live GPS tracking — not in this phase

`RouteMap` already accepts, and draws, a position:

```ts
busLocation?: { latitude: number; longitude: number; recorded_at?: string | null }
```

Nothing supplies it. When it does, the open questions are transport (polling, SSE or WebSocket)
and who writes positions — not the map, which needs only to be handed a changing prop.

## Testing

| Case | Where |
|------|-------|
| Two stops; many stops; ordering by sequence; origin/destination roles | `lib/map.test.ts` |
| Missing coordinates; half a pair; out-of-range; `0,0`; nothing mapped at all | `lib/map.test.ts` |
| Tiles come from the configured server; attribution present; a marker per stop; the line | `components/map/route-map.test.tsx` |
| Popup contents; selecting only what the server offered; the traveller's own points; the bus marker | `components/map/route-map.test.tsx` |
| Empty and partial states | `components/map/route-map-panel.test.tsx` |
| The coordinate picker | `components/map/location-picker.test.tsx` |
| Coordinates on trip, route and admin payloads; travel order; nulls; invalid coordinates refused | `apps/trips/tests/test_route_map.py` |

Leaflet renders in jsdom, so those tests exercise the real library rather than a stub.
