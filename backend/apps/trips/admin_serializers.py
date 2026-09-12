from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from apps.fleet.models import Bus
from apps.routes.admin_serializers import StopBriefSerializer
from apps.routes.models import Route

from .models import STATUS_TRANSITIONS, Recurrence, Trip, TripSchedule, TripStatus
from .services import (
    MAX_GENERATION_DAYS,
    assignment_errors,
    create_trip,
    describe_conflict,
    find_bus_conflict,
    replace_trip_stops,
    route_timetable,
    shift_timings,
    timings_from_route,
    timings_from_trip,
    timings_signature,
    validate_stop_timings,
)

MAX_PRICE = Decimal("100000")
MAX_SCHEDULE_DAYS = 366
EDITABLE_FIELDS = {"route", "bus", "departure_datetime", "base_price", "trip_stops"}


class RouteSummarySerializer(serializers.ModelSerializer):
    origin = StopBriefSerializer(read_only=True)
    destination = StopBriefSerializer(read_only=True)

    class Meta:
        model = Route
        fields = ["id", "name", "route_number", "origin", "destination", "base_fare", "active"]
        read_only_fields = fields


class BusSummarySerializer(serializers.ModelSerializer):
    seat_layout_name = serializers.CharField(
        source="seat_layout.name", read_only=True, default=None
    )

    class Meta:
        model = Bus
        fields = [
            "id",
            "name",
            "registration_number",
            "bus_type",
            "seat_capacity",
            "seat_layout",
            "seat_layout_name",
            "facilities",
            "active",
        ]
        read_only_fields = fields


class TripStopSerializer(serializers.Serializer):
    """Read: the full stop timing. Write: new times for an existing sequence number."""

    sequence = serializers.IntegerField(min_value=1)
    stop = StopBriefSerializer(read_only=True)
    arrival_datetime = serializers.DateTimeField()
    departure_datetime = serializers.DateTimeField()
    is_boarding_point = serializers.BooleanField(read_only=True)
    is_dropoff_point = serializers.BooleanField(read_only=True)


# ---------------------------------------------------------------------------
# Trips
# ---------------------------------------------------------------------------
class AdminTripListSerializer(serializers.ModelSerializer):
    route_summary = RouteSummarySerializer(source="route", read_only=True)
    bus_summary = BusSummarySerializer(source="bus", read_only=True)
    operator_name = serializers.CharField(source="operator.company_name", read_only=True)
    booking_count = serializers.IntegerField(read_only=True)
    booked_seats = serializers.IntegerField(read_only=True)
    available_seats = serializers.IntegerField(read_only=True)

    class Meta:
        model = Trip
        fields = [
            "id",
            "code",
            "route",
            "route_summary",
            "bus",
            "bus_summary",
            "operator",
            "operator_name",
            "schedule",
            "departure_datetime",
            "estimated_arrival_datetime",
            "status",
            "base_price",
            "active",
            "booking_count",
            "booked_seats",
            "available_seats",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "code",
            "operator",
            "schedule",
            "estimated_arrival_datetime",
            "status",
            "created_at",
            "updated_at",
        ]
        extra_kwargs = {
            "base_price": {"required": False, "min_value": Decimal("0"), "max_value": MAX_PRICE},
        }


class AdminTripSerializer(AdminTripListSerializer):
    """
    A trip with its stop timetable. `stops` is optional on write: when omitted the times come
    from the route's offsets (or, on edit, the existing times shifted with the departure).
    """

    stops = TripStopSerializer(many=True, source="trip_stops", required=False)

    class Meta(AdminTripListSerializer.Meta):
        fields = [
            *AdminTripListSerializer.Meta.fields,
            "stops",
            "cancellation_reason",
            "cancelled_at",
        ]
        read_only_fields = [
            *AdminTripListSerializer.Meta.read_only_fields,
            "cancellation_reason",
            "cancelled_at",
        ]

    def validate(self, attrs: dict) -> dict:
        trip: Trip | None = self.instance
        if trip is not None and not trip.is_editable and EDITABLE_FIELDS & attrs.keys():
            raise serializers.ValidationError(
                {
                    "non_field_errors": [
                        f"This trip is {trip.get_status_display().lower()}; only scheduled "
                        "trips can change their route, bus, times or price."
                    ]
                }
            )
        if (
            trip is not None
            and attrs.get("active")
            and trip.status in (TripStatus.CANCELLED, TripStatus.COMPLETED)
        ):
            raise serializers.ValidationError(
                {"active": ["Cancelled or completed trips can’t be put back on sale."]}
            )
        if trip is not None and not EDITABLE_FIELDS & attrs.keys():
            return attrs  # e.g. only toggling `active`: the timetable is untouched

        route = attrs.get("route", getattr(trip, "route", None))
        bus = attrs.get("bus", getattr(trip, "bus", None))
        departure = attrs.get("departure_datetime", getattr(trip, "departure_datetime", None))
        route_changed = trip is None or route.pk != trip.route_id
        bus_changed = trip is None or bus.pk != trip.bus_id
        departure_changed = trip is None or departure != trip.departure_datetime
        if (
            trip is not None
            and (route_changed or bus_changed)
            and trip.passengers.filter(holds_seat=True).exists()
        ):
            raise serializers.ValidationError(
                {
                    "route" if route_changed else "bus": [
                        "Passengers hold seats on this trip, so its route and bus can’t change. "
                        "Cancel the trip instead."
                    ]
                }
            )

        errors = assignment_errors(
            route=route if route_changed else None, bus=bus if bus_changed else None
        )
        if departure_changed and departure <= timezone.now():
            errors["departure_datetime"] = ["Choose a departure time in the future."]
        if trip is None and attrs.get("base_price") is None and route.base_fare is None:
            errors["base_price"] = ["Set a ticket price — this route has no standard fare."]
        if errors:
            raise serializers.ValidationError(errors)
        if trip is None and attrs.get("base_price") is None:
            attrs["base_price"] = route.base_fare

        # Work out the stop timetable this change produces.
        if route_changed:
            baseline = timings_from_route(route_timetable(route), departure)
        else:
            baseline = timings_from_trip(trip)
            if departure_changed:
                baseline = shift_timings(baseline, departure - trip.departure_datetime)
        submitted = attrs.pop("trip_stops", None)
        timings = baseline if submitted is None else self._apply_submitted(baseline, submitted)
        problems = validate_stop_timings(departure, timings)
        if problems:
            raise serializers.ValidationError({"stops": problems})

        arrival = timings[-1]["arrival_datetime"]
        conflict = find_bus_conflict(bus, departure, arrival, exclude_pk=getattr(trip, "pk", None))
        if conflict:
            raise serializers.ValidationError({"bus": [describe_conflict(conflict)]})

        attrs["operator"] = bus.operator
        attrs["estimated_arrival_datetime"] = arrival
        self._timings = timings
        return attrs

    @staticmethod
    def _apply_submitted(baseline: list[dict], submitted: list[dict]) -> list[dict]:
        by_sequence = {item["sequence"]: item for item in submitted}
        if sorted(by_sequence) != [t["sequence"] for t in baseline] or len(submitted) != len(
            baseline
        ):
            raise serializers.ValidationError(
                {"stops": [f"Give times for each of the route’s {len(baseline)} stops, once each."]}
            )
        return [
            {
                **timing,
                "arrival_datetime": by_sequence[timing["sequence"]]["arrival_datetime"],
                "departure_datetime": by_sequence[timing["sequence"]]["departure_datetime"],
            }
            for timing in baseline
        ]

    def create(self, validated_data: dict) -> Trip:
        return create_trip(
            route=validated_data["route"],
            bus=validated_data["bus"],
            departure_datetime=validated_data["departure_datetime"],
            base_price=validated_data["base_price"],
            timings=self._timings,
            active=validated_data.get("active", True),
        )

    @transaction.atomic
    def update(self, instance: Trip, validated_data: dict) -> Trip:
        before = timings_signature(timings_from_trip(instance))
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save()
        if timings_signature(self._timings) != before:
            replace_trip_stops(instance, self._timings)
            self.changed_nested = ["stops"]
        return instance


class TripStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(
        choices=[
            (status, TripStatus(status).label)
            for status in TripStatus.values
            if status != "cancelled"
        ]
    )


class CancelTripSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")


# ---------------------------------------------------------------------------
# Recurring schedules
# ---------------------------------------------------------------------------
class AdminTripScheduleSerializer(serializers.ModelSerializer):
    route_summary = RouteSummarySerializer(source="route", read_only=True)
    bus_summary = BusSummarySerializer(source="bus", read_only=True)
    operator_name = serializers.CharField(source="operator.company_name", read_only=True)
    weekdays = serializers.ListField(
        child=serializers.IntegerField(min_value=0, max_value=6), required=False
    )
    trip_count = serializers.IntegerField(read_only=True)
    upcoming_trip_count = serializers.IntegerField(read_only=True)
    duration_minutes = serializers.SerializerMethodField()

    class Meta:
        model = TripSchedule
        fields = [
            "id",
            "route",
            "route_summary",
            "bus",
            "bus_summary",
            "operator",
            "operator_name",
            "departure_time",
            "base_price",
            "recurrence",
            "weekdays",
            "start_date",
            "end_date",
            "active",
            "last_generated_until",
            "trip_count",
            "upcoming_trip_count",
            "duration_minutes",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "operator", "last_generated_until", "created_at", "updated_at"]
        extra_kwargs = {
            "base_price": {"required": False, "min_value": Decimal("0"), "max_value": MAX_PRICE},
        }

    def get_duration_minutes(self, schedule: TripSchedule) -> int | None:
        duration = getattr(schedule, "journey_duration", None)
        return None if duration is None else int(duration.total_seconds() // 60)

    def validate(self, attrs: dict) -> dict:
        schedule: TripSchedule | None = self.instance
        route = attrs.get("route", getattr(schedule, "route", None))
        bus = attrs.get("bus", getattr(schedule, "bus", None))
        route_changed = schedule is None or route.pk != schedule.route_id
        bus_changed = schedule is None or bus.pk != schedule.bus_id
        errors = assignment_errors(
            route=route if route_changed else None, bus=bus if bus_changed else None
        )

        recurrence = attrs.get("recurrence", getattr(schedule, "recurrence", Recurrence.DAILY))
        weekdays = sorted(set(attrs.get("weekdays", getattr(schedule, "weekdays", []))))
        if recurrence == Recurrence.WEEKLY and not weekdays:
            errors["weekdays"] = ["Pick at least one weekday."]
        attrs["weekdays"] = weekdays if recurrence == Recurrence.WEEKLY else []

        start = attrs.get("start_date", getattr(schedule, "start_date", None))
        end = attrs.get("end_date", getattr(schedule, "end_date", None))
        if start and end and end < start:
            errors["end_date"] = ["The end date can’t be before the start date."]
        elif start and end and (end - start).days > MAX_SCHEDULE_DAYS:
            errors["end_date"] = [
                "A schedule can run for at most a year; add a new one after that."
            ]

        if schedule is None and attrs.get("base_price") is None:
            if route.base_fare is None:
                errors["base_price"] = ["Set a ticket price — this route has no standard fare."]
            else:
                attrs["base_price"] = route.base_fare
        if errors:
            raise serializers.ValidationError(errors)
        attrs["operator"] = bus.operator
        return attrs


class GenerateTripsSerializer(serializers.Serializer):
    from_date = serializers.DateField()
    to_date = serializers.DateField()
    dry_run = serializers.BooleanField(default=False)

    def validate(self, attrs: dict) -> dict:
        if attrs["to_date"] < attrs["from_date"]:
            raise serializers.ValidationError(
                {"to_date": ["The end date can’t be before the start."]}
            )
        if (attrs["to_date"] - attrs["from_date"]).days >= MAX_GENERATION_DAYS:
            raise serializers.ValidationError(
                {"to_date": [f"Generate at most {MAX_GENERATION_DAYS} days at a time."]}
            )
        return attrs


__all__ = [
    "STATUS_TRANSITIONS",
    "AdminTripListSerializer",
    "AdminTripScheduleSerializer",
    "AdminTripSerializer",
    "CancelTripSerializer",
    "GenerateTripsSerializer",
    "TripStatusSerializer",
]
