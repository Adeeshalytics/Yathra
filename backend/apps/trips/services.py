"""
Trip scheduling rules: stop timetables, bus availability, status changes and the generation
of trips from recurring schedules. Serializers validate input; these functions apply it.
"""

from datetime import date, datetime, timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.bookings.services import cancel_trip_bookings, complete_trip_bookings
from apps.operators.models import OperatorStatus

from .models import STATUS_TRANSITIONS, Trip, TripSchedule, TripStatus, TripStop

MAX_JOURNEY = timedelta(hours=72)
MAX_GENERATION_DAYS = 92


def _when(moment: datetime) -> str:
    return timezone.localtime(moment).strftime("%d %b %H:%M")


# ---------------------------------------------------------------------------
# Timetables
# ---------------------------------------------------------------------------
def route_timetable(route) -> list:
    return list(route.route_stops.select_related("stop").order_by("sequence"))


def timings_from_route(route_stops: list, departure: datetime) -> list[dict]:
    """Stop times for a departure, from the route's offsets."""
    return [
        {
            "stop": route_stop.stop,
            "sequence": route_stop.sequence,
            "arrival_datetime": departure + route_stop.arrival_offset,
            "departure_datetime": departure + route_stop.departure_offset,
            "is_boarding_point": route_stop.is_boarding_point,
            "is_dropoff_point": route_stop.is_dropoff_point,
        }
        for route_stop in route_stops
    ]


def timings_from_trip(trip: Trip) -> list[dict]:
    return [
        {
            "stop": trip_stop.stop,
            "sequence": trip_stop.sequence,
            "arrival_datetime": trip_stop.arrival_datetime,
            "departure_datetime": trip_stop.departure_datetime,
            "is_boarding_point": trip_stop.is_boarding_point,
            "is_dropoff_point": trip_stop.is_dropoff_point,
        }
        for trip_stop in trip.trip_stops.select_related("stop").order_by("sequence")
    ]


def shift_timings(timings: list[dict], delta: timedelta) -> list[dict]:
    return [
        {
            **timing,
            "arrival_datetime": timing["arrival_datetime"] + delta,
            "departure_datetime": timing["departure_datetime"] + delta,
        }
        for timing in timings
    ]


def timings_signature(timings: list[dict]) -> list[tuple]:
    return [
        (t["stop"].pk, t["sequence"], t["arrival_datetime"], t["departure_datetime"])
        for t in timings
    ]


def validate_stop_timings(departure: datetime, timings: list[dict]) -> list[str]:
    """Readable problems with a trip's stop times (empty list = valid)."""
    if len(timings) < 2:
        return ["A trip needs at least an origin and a destination stop."]
    errors: list[str] = []
    origin = timings[0]
    if origin["arrival_datetime"] != departure or origin["departure_datetime"] != departure:
        errors.append(
            f"{origin['stop'].name} is the origin, so it must match the trip’s departure "
            f"time ({_when(departure)})."
        )
    for index, timing in enumerate(timings):
        name = timing["stop"].name
        if timing["departure_datetime"] < timing["arrival_datetime"]:
            errors.append(f"{name}: departure can’t be before arrival.")
        if index > 0:
            previous = timings[index - 1]
            if timing["arrival_datetime"] <= previous["departure_datetime"]:
                errors.append(
                    f"{name}: the bus must arrive after leaving {previous['stop'].name} "
                    f"({_when(previous['departure_datetime'])})."
                )
    if timings[-1]["arrival_datetime"] - departure > MAX_JOURNEY:
        errors.append("A journey can’t take longer than 72 hours.")
    return errors


def replace_trip_stops(trip: Trip, timings: list[dict]) -> None:
    trip.trip_stops.all().delete()
    TripStop.objects.bulk_create(
        TripStop(
            trip=trip,
            stop=timing["stop"],
            sequence=timing["sequence"],
            arrival_datetime=timing["arrival_datetime"],
            departure_datetime=timing["departure_datetime"],
            is_boarding_point=timing["is_boarding_point"],
            is_dropoff_point=timing["is_dropoff_point"],
        )
        for timing in timings
    )


# ---------------------------------------------------------------------------
# Assignment rules
# ---------------------------------------------------------------------------
def assignment_errors(*, route=None, bus=None) -> dict[str, list[str]]:
    """Why a route / bus can't be used for new trips (pass None to skip a check)."""
    errors: dict[str, list[str]] = {}
    if route is not None:
        if not route.active:
            errors["route"] = ["This route is inactive."]
        elif route.route_stops.count() < 2:
            errors["route"] = ["This route has no stop timetable yet."]
    if bus is not None:
        problems = []
        if not bus.active:
            problems.append("This bus is inactive.")
        if bus.seat_layout_id is None:
            problems.append("Assign a seat layout to this bus before scheduling it.")
        if bus.operator.status != OperatorStatus.ACTIVE:
            problems.append(f"{bus.operator.company_name} isn’t an approved, active operator.")
        if problems:
            errors["bus"] = problems
    return errors


def find_bus_conflict(bus, departure: datetime, arrival: datetime, *, exclude_pk=None):
    """The first non-cancelled trip of this bus whose journey overlaps [departure, arrival)."""
    trips = (
        Trip.objects.filter(
            bus=bus, departure_datetime__lt=arrival, estimated_arrival_datetime__gt=departure
        )
        .exclude(status=TripStatus.CANCELLED)
        .select_related("route", "bus")
    )
    if exclude_pk is not None:
        trips = trips.exclude(pk=exclude_pk)
    return trips.order_by("departure_datetime").first()


def describe_conflict(trip: Trip) -> str:
    return (
        f"{trip.bus.registration_number} is already running {trip.code} ({trip.route.name}) "
        f"from {_when(trip.departure_datetime)} to {_when(trip.estimated_arrival_datetime)}."
    )


# ---------------------------------------------------------------------------
# Trips
# ---------------------------------------------------------------------------
@transaction.atomic
def create_trip(
    *,
    route,
    bus,
    departure_datetime: datetime,
    base_price,
    timings: list[dict],
    active: bool = True,
    schedule: TripSchedule | None = None,
) -> Trip:
    trip = Trip.objects.create(
        route=route,
        bus=bus,
        operator=bus.operator,
        schedule=schedule,
        departure_datetime=departure_datetime,
        estimated_arrival_datetime=timings[-1]["arrival_datetime"],
        base_price=base_price,
        active=active,
    )
    replace_trip_stops(trip, timings)
    return trip


def change_status(trip: Trip, status: str) -> None:
    if status not in STATUS_TRANSITIONS[trip.status]:
        current = TripStatus(trip.status).label.lower()
        target = TripStatus(status).label.lower()
        raise ValidationError({"status": [f"A {current} trip can’t be marked {target}."]})
    trip.status = status
    trip.save(update_fields=["status", "updated_at"])
    if status == TripStatus.COMPLETED:
        complete_trip_bookings(trip)


def cancel_trip(trip: Trip, reason: str) -> None:
    if trip.status in (TripStatus.COMPLETED, TripStatus.CANCELLED):
        raise ValidationError(
            {"non_field_errors": [f"This trip is already {trip.get_status_display().lower()}."]}
        )
    trip.status = TripStatus.CANCELLED
    trip.active = False
    trip.cancellation_reason = reason
    trip.cancelled_at = timezone.now()
    trip.save(
        update_fields=["status", "active", "cancellation_reason", "cancelled_at", "updated_at"]
    )
    # Every live booking is cancelled and its seats freed in the same transaction.
    cancel_trip_bookings(trip, reason)


# ---------------------------------------------------------------------------
# Schedules
# ---------------------------------------------------------------------------
def schedule_dates(schedule: TripSchedule, start: date, end: date) -> list[date]:
    first = max(start, schedule.start_date)
    last = min(end, schedule.end_date) if schedule.end_date else end
    days = []
    day = first
    while day <= last:
        if schedule.runs_on(day):
            days.append(day)
        day += timedelta(days=1)
    return days


@transaction.atomic
def generate_trips(
    schedule: TripSchedule, start: date, end: date, *, dry_run: bool = False
) -> dict:
    """
    Create one trip per matching day in [start, end] (clipped to the schedule's own window).
    Safe to repeat: days already scheduled, clashing with another journey of the bus, or in
    the past are skipped and reported. With ``dry_run`` nothing is saved.
    """
    route_stops = route_timetable(schedule.route)
    if len(route_stops) < 2:
        raise ValidationError({"route": ["This route has no stop timetable yet."]})

    tz = timezone.get_current_timezone()
    now = timezone.now()
    planned: list[tuple[datetime, datetime]] = []
    occurrences = []

    for day in schedule_dates(schedule, start, end):
        departure = timezone.make_aware(datetime.combine(day, schedule.departure_time), tz)
        timings = timings_from_route(route_stops, departure)
        arrival = timings[-1]["arrival_datetime"]
        occurrence = {
            "date": day,
            "departure_datetime": departure,
            "arrival_datetime": arrival,
            "result": "",
            "detail": "",
            "trip_id": None,
        }

        existing = (
            Trip.objects.filter(bus=schedule.bus, departure_datetime=departure)
            .exclude(status=TripStatus.CANCELLED)
            .first()
        )
        conflict = find_bus_conflict(schedule.bus, departure, arrival)
        if departure <= now:
            occurrence.update(result="past", detail="The departure time has already passed.")
        elif existing:
            occurrence.update(
                result="exists",
                detail=f"{existing.code} is already scheduled.",
                trip_id=existing.id,
            )
        elif conflict:
            occurrence.update(result="conflict", detail=describe_conflict(conflict))
        elif any(departure < end_ and arrival > start_ for start_, end_ in planned):
            occurrence.update(result="conflict", detail="Overlaps another trip in this batch.")
        elif dry_run:
            occurrence.update(result="planned")
            planned.append((departure, arrival))
        else:
            trip = create_trip(
                route=schedule.route,
                bus=schedule.bus,
                departure_datetime=departure,
                base_price=schedule.base_price,
                timings=timings,
                schedule=schedule,
            )
            occurrence.update(result="created", detail=f"Created {trip.code}.", trip_id=trip.id)
        occurrences.append(occurrence)

    created = sum(1 for o in occurrences if o["result"] == "created")
    covered = min(end, schedule.end_date) if schedule.end_date else end
    if not dry_run and (
        schedule.last_generated_until is None or covered > schedule.last_generated_until
    ):
        # The schedule is handled up to `covered` whether its days were created now or existed.
        schedule.last_generated_until = covered
        schedule.save(update_fields=["last_generated_until", "updated_at"])

    return {
        "from_date": start,
        "to_date": end,
        "dry_run": dry_run,
        "created": created,
        "planned": sum(1 for o in occurrences if o["result"] == "planned"),
        "skipped": sum(1 for o in occurrences if o["result"] in ("past", "exists", "conflict")),
        "occurrences": occurrences,
    }
