"""
The road a bus actually drives.

A route drawn as straight lines between its stops is a lie: buses follow roads. This module
asks a routing service for the real geometry and hands back an encoded polyline.

The service speaks the OSRM protocol — OSRM is OpenStreetMap's own routing engine, so the roads
it knows are the roads the map tiles show. `ROUTING_SERVICE_URL` decides which instance answers:
the public demo server is fine while developing, but it is not licensed for production traffic,
so a deployment should point this at its own container (see docs/route-maps.md).

Nothing here is called while a customer waits. A route's road path changes only when its stops
change, so it is worked out once and stored on the route (`apps.routes.services`), which is also
why a slow or missing routing service can never slow the booking flow down.
"""

import json
import logging
from dataclasses import dataclass
from decimal import Decimal
from urllib import error, parse, request

from django.conf import settings

logger = logging.getLogger("apps.routes.routing")

# OSRM's own encoding for the geometry it returns. Precision 5 is ~1 m — far finer than a bus
# route needs, and half the size of precision 6.
POLYLINE_PRECISION = 5


@dataclass(frozen=True)
class RoadPath:
    """The geometry of one journey along real roads."""

    geometry: str
    distance_m: int
    duration_s: int
    source: str

    @property
    def is_empty(self) -> bool:
        return not self.geometry


class RoutingUnavailable(Exception):
    """The routing service could not be reached, or answered with something unusable."""


def _service() -> tuple[str, str, float]:
    config = getattr(settings, "ROUTING_SERVICE", {})
    return (
        (config.get("URL") or "").rstrip("/"),
        config.get("PROFILE") or "driving",
        float(config.get("TIMEOUT_SECONDS") or 8),
    )


def is_configured() -> bool:
    """False when no routing service is set up; callers then keep the straight-line fallback."""
    return bool(_service()[0])


def _coordinate_pairs(coordinates) -> str:
    # OSRM takes longitude first — the opposite of the way people write coordinates, and an
    # easy way to end up routing through the Indian Ocean.
    return ";".join(
        f"{float(longitude):.6f},{float(latitude):.6f}" for latitude, longitude in coordinates
    )


def road_path(coordinates: list[tuple[Decimal | float, Decimal | float]]) -> RoadPath:
    """
    The driving route through `coordinates` (latitude, longitude), in order.

    Raises `RoutingUnavailable` if the service is unreachable, times out, or cannot find a road
    between the stops — the caller decides what to do about it (usually: keep the fallback and
    try again later).
    """
    base, profile, timeout = _service()
    if not base:
        raise RoutingUnavailable("No routing service is configured.")
    if len(coordinates) < 2:
        raise RoutingUnavailable("A road route needs at least two points.")

    query = parse.urlencode(
        {"overview": "full", "geometries": "polyline", "continue_straight": "false"}
    )
    url = f"{base}/route/v1/{profile}/{_coordinate_pairs(coordinates)}?{query}"

    if not url.startswith(("http://", "https://")):
        raise RoutingUnavailable("ROUTING_SERVICE_URL must be an http(s) address.")

    try:
        # S310: the scheme is checked just above, and the host comes from our own settings.
        probe = request.Request(url, headers={"User-Agent": f"{settings.APP_NAME}/1.0"})  # noqa: S310
        with request.urlopen(probe, timeout=timeout) as response:  # noqa: S310
            payload = json.loads(response.read().decode())
    except (error.URLError, TimeoutError, OSError) as exc:
        raise RoutingUnavailable(f"Routing service unreachable: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise RoutingUnavailable("Routing service returned something that wasn't JSON.") from exc

    if payload.get("code") != "Ok" or not payload.get("routes"):
        raise RoutingUnavailable(
            f"Routing service could not connect these stops by road ({payload.get('code')})."
        )

    best = payload["routes"][0]
    geometry = best.get("geometry") or ""
    if not geometry:
        raise RoutingUnavailable("Routing service returned a route with no geometry.")

    return RoadPath(
        geometry=geometry,
        distance_m=round(best.get("distance") or 0),
        duration_s=round(best.get("duration") or 0),
        source=_source_name(base),
    )


def _source_name(base: str) -> str:
    """A short label for where the geometry came from, kept with the path for support."""
    host = parse.urlparse(base).hostname or "routing"
    return host[:32]
