"""Route timetable rules, the atomic replacement of a stop list, and the road path."""

import logging
from datetime import timedelta

from django.utils import timezone

from . import routing
from .models import Route, RouteStop, Stop

logger = logging.getLogger("apps.routes")

MAX_OFFSET_MINUTES = 72 * 60


def validate_route_stops(entries: list[dict]) -> list[str]:
    """
    Check an ordered stop list. Offsets are minutes after the trip departs from the origin.
    Returns readable messages (empty list = valid).
    """
    if len(entries) < 2:
        return ["A route needs at least two stops: an origin and a destination."]

    errors: list[str] = []
    first_seen: dict = {}
    for position, entry in enumerate(entries, start=1):
        stop = entry["stop"]
        arrival, departure = entry["arrival_offset"], entry["departure_offset"]
        if stop.pk in first_seen:
            errors.append(
                f"{stop.name} appears more than once (stops {first_seen[stop.pk]} and {position})."
            )
        else:
            first_seen[stop.pk] = position
        if departure < arrival:
            errors.append(f"Stop {position} ({stop.name}): departure can’t be before arrival.")
        if position > 1:
            previous = entries[position - 2]
            if arrival <= previous["departure_offset"]:
                errors.append(
                    f"Stop {position} ({stop.name}): the bus must arrive after it leaves "
                    f"{previous['stop'].name}. Check the order of the stops and their times."
                )

    origin, destination = entries[0], entries[-1]
    if origin["arrival_offset"] != 0 or origin["departure_offset"] != 0:
        errors.append("The origin’s arrival and departure offsets must both be 0 minutes.")
    if not origin["is_boarding_point"]:
        errors.append("Passengers must be able to board at the origin.")
    if not destination["is_dropoff_point"]:
        errors.append("Passengers must be able to get off at the destination.")
    return errors


def replace_route_stops(route: Route, entries: list[dict]) -> bool:
    """
    Replace the route's stops with `entries` (already validated), numbering them 1..N.
    Call inside a transaction. Returns False when nothing changed.
    """
    proposed = [
        (
            entry["stop"].pk,
            timedelta(minutes=entry["arrival_offset"]),
            timedelta(minutes=entry["departure_offset"]),
            entry.get("is_boarding_point", True),
            entry.get("is_dropoff_point", True),
        )
        for entry in entries
    ]
    current = list(
        route.route_stops.order_by("sequence").values_list(
            "stop_id", "arrival_offset", "departure_offset", "is_boarding_point", "is_dropoff_point"
        )
    )
    if current == proposed:
        return False

    route.route_stops.all().delete()
    RouteStop.objects.bulk_create(
        RouteStop(
            route=route,
            stop_id=stop_id,
            sequence=sequence,
            arrival_offset=arrival,
            departure_offset=departure,
            is_boarding_point=boarding,
            is_dropoff_point=dropoff,
        )
        for sequence, (stop_id, arrival, departure, boarding, dropoff) in enumerate(proposed, 1)
    )
    return True


# ---------------------------------------------------------------------------
# The road a bus drives
# ---------------------------------------------------------------------------
PATH_FIELDS = ["path", "path_distance_m", "path_duration_s", "path_source", "path_updated_at"]


def route_coordinates(route: Route) -> list[tuple]:
    """The route stops that have been mapped, in travel order, as (latitude, longitude)."""
    return [
        (stop.stop.latitude, stop.stop.longitude)
        for stop in route.route_stops.select_related("stop").order_by("sequence")
        if stop.stop.latitude is not None and stop.stop.longitude is not None
    ]


def clear_route_path(route: Route) -> None:
    """
    Forget the stored road path.

    Called the moment a route stop list changes: the old geometry belongs to the old stops, and
    drawing it against the new ones would put the bus on roads it no longer takes. With no path
    the map falls back to straight lines, which is visibly approximate rather than quietly wrong.
    """
    Route.objects.filter(pk=route.pk).update(
        path="", path_distance_m=None, path_duration_s=None, path_source="", path_updated_at=None
    )


def refresh_route_path(route: Route) -> bool:
    """
    Work out the road between this route stops and store it. Returns False when it could not be.

    Failure is never fatal: the routing service is optional infrastructure, so a route simply
    keeps its straight-line fallback until `refresh_route_paths` picks it up again.
    """
    if not routing.is_configured():
        return False

    coordinates = route_coordinates(route)
    if len(coordinates) < 2:
        return False

    try:
        path = routing.road_path(coordinates)
    except routing.RoutingUnavailable as exc:
        logger.warning("No road path for route %s: %s", route.pk, exc)
        return False

    Route.objects.filter(pk=route.pk).update(
        path=path.geometry,
        path_distance_m=path.distance_m,
        path_duration_s=path.duration_s,
        path_source=path.source,
        path_updated_at=timezone.now(),
    )
    return True


def clear_paths_through_stop(stop: Stop) -> int:
    """Every route through this stop needs a new road path once the stop itself has moved."""
    return (
        Route.objects.filter(route_stops__stop=stop)
        .exclude(path="")
        .distinct()
        .update(
            path="",
            path_distance_m=None,
            path_duration_s=None,
            path_source="",
            path_updated_at=None,
        )
    )
