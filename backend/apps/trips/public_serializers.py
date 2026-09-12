"""Serializers for the public (customer) trip API: search, trip details, stops and seats."""

import uuid
from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from rest_framework import serializers

from apps.fleet.models import Bus, BusType
from apps.operators.models import Operator
from apps.routes.models import Route, Stop

from .models import Trip, TripStop
from .search import DEPARTURE_PERIODS, MAX_DAYS_AHEAD, MAX_PASSENGERS, SORTS, Place


def _minutes(value: timedelta) -> int:
    return int(value.total_seconds() // 60)


# ---------------------------------------------------------------------------
# Search query
# ---------------------------------------------------------------------------
class CommaSeparatedField(serializers.Field):
    """`a,b,c` in a query string → a de-duplicated list validated by `child`."""

    def __init__(self, child: serializers.Field, **kwargs):
        self.child = child
        super().__init__(**kwargs)

    def to_internal_value(self, data):
        values = [part.strip() for part in str(data).split(",") if part.strip()]
        return list(dict.fromkeys(self.child.run_validation(value) for value in values))

    def to_representation(self, value):
        return ",".join(str(item) for item in value)


def resolve_place(value: str) -> Place:
    """A stop id (from the location pickers) or a city / stop name (typed or linked)."""
    value = value.strip()
    try:
        stop_id = uuid.UUID(value)
    except ValueError:
        stop = (
            Stop.objects.filter(active=True, city__iexact=value).first()
            or Stop.objects.filter(active=True, name__iexact=value).first()
        )
        if stop is None:
            raise serializers.ValidationError("We don’t have any stops in this place.") from None
        return Place(city=stop.city, label=stop.city)
    stop = Stop.objects.filter(pk=stop_id, active=True).first()
    if stop is None:
        raise serializers.ValidationError("This stop isn’t available any more.")
    return Place(city=stop.city, label=stop.name, stop_id=str(stop.pk))


class TripSearchQuerySerializer(serializers.Serializer):
    """Validates `?from=&to=&date=&passengers=` plus filters and sorting."""

    def get_fields(self):
        place_messages = {
            "from": "Choose where you’re leaving from.",
            "to": "Choose your destination.",
        }
        price = {"max_digits": 10, "decimal_places": 2, "min_value": 0, "required": False}
        return {
            **{
                name: serializers.CharField(
                    max_length=120, error_messages={"required": message, "blank": message}
                )
                for name, message in place_messages.items()
            },
            "date": serializers.DateField(
                error_messages={
                    "required": "Choose a travel date.",
                    "invalid": "Use a travel date like 2026-09-15.",
                }
            ),
            "passengers": serializers.IntegerField(
                min_value=1,
                max_value=MAX_PASSENGERS,
                default=1,
                error_messages={
                    "min_value": "Choose at least one passenger.",
                    "max_value": f"You can search for up to {MAX_PASSENGERS} passengers.",
                },
            ),
            "sort": serializers.ChoiceField(choices=list(SORTS), default="departure"),
            "bus_type": CommaSeparatedField(
                serializers.ChoiceField(choices=BusType.choices), required=False
            ),
            "ac": serializers.BooleanField(required=False, allow_null=True, default=None),
            "min_price": serializers.DecimalField(**price),
            "max_price": serializers.DecimalField(**price),
            "departure": CommaSeparatedField(
                serializers.ChoiceField(choices=list(DEPARTURE_PERIODS)), required=False
            ),
            "operator": CommaSeparatedField(serializers.UUIDField(), required=False),
        }

    def validate_from(self, value: str) -> Place:
        return resolve_place(value)

    def validate_to(self, value: str) -> Place:
        return resolve_place(value)

    def validate_date(self, value):
        today = timezone.localdate()
        if value < today:
            raise serializers.ValidationError("Travel date can’t be in the past.")
        if value > today + timedelta(days=MAX_DAYS_AHEAD):
            raise serializers.ValidationError(f"You can search up to {MAX_DAYS_AHEAD} days ahead.")
        return value

    def validate(self, attrs: dict) -> dict:
        if attrs["from"].city.lower() == attrs["to"].city.lower():
            raise serializers.ValidationError(
                {"to": ["Choose a destination different from where you’re leaving."]}
            )
        low, high = attrs.get("min_price"), attrs.get("max_price")
        if low is not None and high is not None and low > high:
            raise serializers.ValidationError(
                {"max_price": ["The maximum price can’t be below the minimum."]}
            )
        return attrs


# ---------------------------------------------------------------------------
# Building blocks
# ---------------------------------------------------------------------------
class PublicStopSerializer(serializers.ModelSerializer):
    class Meta:
        model = Stop
        fields = ["id", "name", "city"]
        read_only_fields = fields


class PublicRouteSerializer(serializers.ModelSerializer):
    origin = PublicStopSerializer(read_only=True)
    destination = PublicStopSerializer(read_only=True)

    class Meta:
        model = Route
        fields = ["id", "name", "route_number", "origin", "destination"]
        read_only_fields = fields


class PublicOperatorSerializer(serializers.ModelSerializer):
    name = serializers.CharField(source="company_name", read_only=True)

    class Meta:
        model = Operator
        fields = ["id", "name"]
        read_only_fields = fields


class PublicBusSerializer(serializers.ModelSerializer):
    bus_type_label = serializers.CharField(source="get_bus_type_display", read_only=True)
    seat_layout_name = serializers.CharField(
        source="seat_layout.name", read_only=True, default=None
    )
    is_ac = serializers.SerializerMethodField()

    class Meta:
        model = Bus
        fields = [
            "name",
            "registration_number",
            "bus_type",
            "bus_type_label",
            "is_ac",
            "facilities",
            "seat_capacity",
            "seat_layout_name",
        ]
        read_only_fields = fields

    def get_is_ac(self, bus: Bus) -> bool:
        return "ac" in (bus.facilities or [])


class PublicTripStopSerializer(serializers.ModelSerializer):
    stop = PublicStopSerializer(read_only=True)

    class Meta:
        model = TripStop
        fields = [
            "sequence",
            "stop",
            "arrival_datetime",
            "departure_datetime",
            "is_boarding_point",
            "is_dropoff_point",
        ]
        read_only_fields = fields


class StopTimeSerializer(serializers.Serializer):
    """A boarding point (with its departure time) or drop-off point (with its arrival time)."""

    sequence = serializers.IntegerField()
    stop = PublicStopSerializer()
    time = serializers.DateTimeField()


def boarding_point(trip_stop: TripStop) -> dict:
    return StopTimeSerializer(
        {
            "sequence": trip_stop.sequence,
            "stop": trip_stop.stop,
            "time": trip_stop.departure_datetime,
        }
    ).data


def dropoff_point(trip_stop: TripStop) -> dict:
    return StopTimeSerializer(
        {"sequence": trip_stop.sequence, "stop": trip_stop.stop, "time": trip_stop.arrival_datetime}
    ).data


class _PublicTripBase(serializers.ModelSerializer):
    route = PublicRouteSerializer(read_only=True)
    operator = PublicOperatorSerializer(read_only=True)
    bus = PublicBusSerializer(read_only=True)
    arrival_datetime = serializers.DateTimeField(
        source="estimated_arrival_datetime", read_only=True
    )
    price = serializers.DecimalField(
        source="base_price", max_digits=10, decimal_places=2, read_only=True
    )
    currency = serializers.SerializerMethodField()
    available_seats = serializers.IntegerField(read_only=True)

    def get_currency(self, trip: Trip) -> str:
        return settings.DEFAULT_CURRENCY


# ---------------------------------------------------------------------------
# Responses
# ---------------------------------------------------------------------------
class TripSearchResultSerializer(_PublicTripBase):
    """One bus in the search results, described for the customer's own journey."""

    boarding = serializers.SerializerMethodField()
    dropoff = serializers.SerializerMethodField()
    duration_minutes = serializers.SerializerMethodField()
    boarding_points = serializers.SerializerMethodField()
    dropoff_points = serializers.SerializerMethodField()

    class Meta:
        model = Trip
        fields = [
            "id",
            "code",
            "route",
            "operator",
            "bus",
            "departure_datetime",
            "arrival_datetime",
            "boarding",
            "dropoff",
            "duration_minutes",
            "price",
            "currency",
            "available_seats",
            "boarding_points",
            "dropoff_points",
        ]
        read_only_fields = fields

    @staticmethod
    def _stop(trip: Trip, sequence: int) -> TripStop:
        return next(stop for stop in trip.trip_stops.all() if stop.sequence == sequence)

    def get_boarding(self, trip: Trip) -> dict:
        return boarding_point(self._stop(trip, trip.board_sequence))

    def get_dropoff(self, trip: Trip) -> dict:
        return dropoff_point(self._stop(trip, trip.drop_sequence))

    def get_duration_minutes(self, trip: Trip) -> int:
        return _minutes(trip.duration)

    def get_boarding_points(self, trip: Trip) -> list[dict]:
        """Where the customer could get on and still reach the searched destination."""
        now = timezone.now()
        return [
            boarding_point(stop)
            for stop in trip.trip_stops.all()
            if stop.is_boarding_point
            and stop.stop.active
            and stop.sequence < trip.drop_sequence
            and stop.departure_datetime > now
        ]

    def get_dropoff_points(self, trip: Trip) -> list[dict]:
        """Where the customer could get off after boarding at the searched origin."""
        return [
            dropoff_point(stop)
            for stop in trip.trip_stops.all()
            if stop.is_dropoff_point and stop.stop.active and stop.sequence > trip.board_sequence
        ]


class PublicTripSerializer(_PublicTripBase):
    """Everything the trip page shows: the full route, every stop and the bus."""

    duration_minutes = serializers.SerializerMethodField()
    stops = PublicTripStopSerializer(source="trip_stops", many=True, read_only=True)

    class Meta:
        model = Trip
        fields = [
            "id",
            "code",
            "status",
            "route",
            "operator",
            "bus",
            "departure_datetime",
            "arrival_datetime",
            "duration_minutes",
            "price",
            "currency",
            "available_seats",
            "stops",
        ]
        read_only_fields = fields

    def get_duration_minutes(self, trip: Trip) -> int:
        return _minutes(trip.estimated_arrival_datetime - trip.departure_datetime)
