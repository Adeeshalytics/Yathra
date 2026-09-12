"""
Customer trip search. A trip matches when it has a boarding point in the "from" place and a
later drop-off point in the "to" place, so a Colombo → Batticaloa bus is also found for
Kurunegala → Dambulla. The travel date is the day the customer boards at their stop.
"""

from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from django.db.models import (
    DurationField,
    Exists,
    ExpressionWrapper,
    F,
    OuterRef,
    Q,
    QuerySet,
    Subquery,
)
from django.db.models.functions import ExtractHour
from django.utils import timezone

from apps.fleet.models import BusType
from apps.routes.models import RouteStop

from .models import Trip, TripStop
from .selectors import on_sale_trips, ordered_stops, with_availability
from .services import MAX_JOURNEY

MAX_PASSENGERS = 10
MAX_DAYS_AHEAD = 180

# key: (label, first hour, hour after the last) — by the time the bus leaves the boarding stop.
DEPARTURE_PERIODS = {
    "early_morning": ("Before 6 AM", 0, 6),
    "morning": ("6 AM – 12 PM", 6, 12),
    "afternoon": ("12 PM – 6 PM", 12, 18),
    "evening": ("After 6 PM", 18, 24),
}

SORTS = {
    "departure": ("board_time", "base_price"),
    "-departure": ("-board_time", "base_price"),
    "price": ("base_price", "board_time"),
    "-price": ("-base_price", "board_time"),
    "duration": ("duration", "board_time"),
    "seats": ("-available_seats", "board_time"),
}


@dataclass(frozen=True)
class Place:
    """Where the customer travels from / to. Searches match every stop in the city."""

    city: str
    label: str
    stop_id: str | None = None

    def as_dict(self) -> dict:
        return {"city": self.city, "label": self.label, "stop_id": self.stop_id}


def day_bounds(day: date) -> tuple[datetime, datetime]:
    start = timezone.make_aware(datetime.combine(day, time.min))
    return start, start + timedelta(days=1)


def matching_trips(origin: Place, destination: Place) -> QuerySet[Trip]:
    """
    On-sale trips from `origin` to `destination` that can still be boarded, annotated with the
    matched stops (`board_sequence`, `board_time`, `drop_sequence`, `drop_time`), the
    customer's journey `duration`, the boarding hour and seat availability.
    """
    boarding = TripStop.objects.filter(
        trip=OuterRef("pk"),
        is_boarding_point=True,
        stop__active=True,
        stop__city__iexact=origin.city,
    ).order_by("sequence")
    dropoff = TripStop.objects.filter(
        trip=OuterRef("pk"),
        is_dropoff_point=True,
        stop__active=True,
        stop__city__iexact=destination.city,
        sequence__gt=OuterRef("board_sequence"),
    ).order_by("sequence")
    return (
        with_availability(on_sale_trips())
        .annotate(
            board_sequence=Subquery(boarding.values("sequence")[:1]),
            board_time=Subquery(boarding.values("departure_datetime")[:1]),
        )
        .filter(board_sequence__isnull=False, board_time__gt=timezone.now())
        .annotate(
            drop_sequence=Subquery(dropoff.values("sequence")[:1]),
            drop_time=Subquery(dropoff.values("arrival_datetime")[:1]),
        )
        .filter(drop_sequence__isnull=False)
        .annotate(
            duration=ExpressionWrapper(F("drop_time") - F("board_time"), DurationField()),
            board_hour=ExtractHour("board_time", tzinfo=timezone.get_current_timezone()),
        )
    )


def trips_on(queryset: QuerySet[Trip], day: date) -> QuerySet[Trip]:
    start, end = day_bounds(day)
    return queryset.filter(
        # Cheap pre-filter on the indexed column: boarding is at most MAX_JOURNEY after departure.
        departure_datetime__gt=start - MAX_JOURNEY,
        departure_datetime__lt=end,
        board_time__gte=start,
        board_time__lt=end,
    )


def apply_filters(queryset: QuerySet[Trip], params: dict) -> QuerySet[Trip]:
    if params.get("bus_type"):
        queryset = queryset.filter(bus__bus_type__in=params["bus_type"])
    if params.get("ac") is not None:
        has_ac = Q(bus__facilities__contains=["ac"])
        queryset = queryset.filter(has_ac) if params["ac"] else queryset.exclude(has_ac)
    if params.get("min_price") is not None:
        queryset = queryset.filter(base_price__gte=params["min_price"])
    if params.get("max_price") is not None:
        queryset = queryset.filter(base_price__lte=params["max_price"])
    if params.get("departure"):
        periods = Q()
        for key in params["departure"]:
            _, first, last = DEPARTURE_PERIODS[key]
            periods |= Q(board_hour__gte=first, board_hour__lt=last)
        queryset = queryset.filter(periods)
    if params.get("operator"):
        queryset = queryset.filter(operator_id__in=params["operator"])
    return queryset


def build_facets(queryset: QuerySet[Trip]) -> dict:
    """Counts for every filter option, over the unfiltered matches for the day."""
    rows = list(
        queryset.values(
            "operator_id", "operator__company_name", "bus__bus_type", "bus__facilities",
            "base_price", "board_hour",
        )
    )  # fmt: skip
    operators = Counter((row["operator_id"], row["operator__company_name"]) for row in rows)
    bus_types = Counter(row["bus__bus_type"] for row in rows)
    with_ac = sum(1 for row in rows if "ac" in (row["bus__facilities"] or []))
    prices = [row["base_price"] for row in rows]

    def in_period(row, first, last):
        return first <= row["board_hour"] < last

    return {
        "total": len(rows),
        "operators": sorted(
            (
                {"id": str(operator_id), "name": name, "count": count}
                for (operator_id, name), count in operators.items()
            ),
            key=lambda item: item["name"].lower(),
        ),
        "bus_types": [
            {"value": value, "label": label, "count": bus_types.get(value, 0)}
            for value, label in BusType.choices
        ],
        "departure_periods": [
            {
                "value": key,
                "label": label,
                "count": sum(1 for row in rows if in_period(row, first, last)),
            }
            for key, (label, first, last) in DEPARTURE_PERIODS.items()
        ],
        "ac": {"ac": with_ac, "non_ac": len(rows) - with_ac},
        "price": {
            "min": str(min(prices)) if prices else None,
            "max": str(max(prices)) if prices else None,
        },
    }


def route_exists(origin: Place, destination: Place) -> bool:
    """Whether any active route takes passengers from `origin` to `destination` at all."""
    later_dropoff = RouteStop.objects.filter(
        route=OuterRef("route"),
        is_dropoff_point=True,
        stop__active=True,
        stop__city__iexact=destination.city,
        sequence__gt=OuterRef("sequence"),
    )
    return (
        RouteStop.objects.filter(
            route__active=True,
            is_boarding_point=True,
            stop__active=True,
            stop__city__iexact=origin.city,
        )
        .filter(Exists(later_dropoff))
        .exists()
    )


def nearest_available_date(matches: QuerySet[Trip], day: date, passengers: int) -> date | None:
    """The closest other day with a bus that has enough seats (later days first)."""
    start, end = day_bounds(day)
    candidates = matches.filter(available_seats__gte=passengers)
    later = candidates.filter(board_time__gte=end).order_by("board_time")
    moment = later.values_list("board_time", flat=True).first()
    if moment is None:
        earlier = candidates.filter(board_time__lt=start).order_by("-board_time")
        moment = earlier.values_list("board_time", flat=True).first()
    return timezone.localdate(moment) if moment else None


@dataclass
class SearchOutcome:
    results: QuerySet[Trip]
    facets: dict
    route_exists: bool
    nearest_available_date: date | None


def search_trips(params: dict) -> SearchOutcome:
    origin, destination = params["from"], params["to"]
    matches = matching_trips(origin, destination)
    day_matches = trips_on(matches, params["date"]).filter(
        available_seats__gte=params["passengers"]
    )
    facets = build_facets(day_matches)
    results = (
        apply_filters(day_matches, params)
        .select_related("route__origin", "route__destination", "operator", "bus__seat_layout")
        .prefetch_related(ordered_stops())
        .order_by(*SORTS[params["sort"]], "pk")
    )
    empty = facets["total"] == 0
    exists = route_exists(origin, destination) if empty else True
    return SearchOutcome(
        results=results,
        facets=facets,
        route_exists=exists,
        nearest_available_date=(
            nearest_available_date(matches, params["date"], params["passengers"])
            if empty and exists
            else None
        ),
    )
