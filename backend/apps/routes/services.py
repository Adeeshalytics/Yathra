"""Route timetable rules and the atomic replacement of a route's stop list."""

from datetime import timedelta

from .models import Route, RouteStop

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
