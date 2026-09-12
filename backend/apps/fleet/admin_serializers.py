from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers

from apps.operators.models import OperatorStatus
from apps.trips.models import OPEN_TRIP_STATUSES, Trip, TripSchedule
from apps.trips.selectors import with_availability

from .models import (
    AIR_CONDITIONED_BUS_TYPES,
    BOOKABLE_SEAT_TYPES,
    CREW_SEAT_TYPES,
    MAX_LAYOUT_COLUMNS,
    MAX_LAYOUT_ROWS,
    MAX_SEAT_CAPACITY,
    MIN_LAYOUT_COLUMNS,
    Bus,
    BusFacility,
    Seat,
    SeatLayout,
    SeatLayoutType,
)
from .seat_layouts import (
    MAX_PASSENGER_ROWS,
    MIN_PASSENGER_ROWS,
    SEAT_NUMBER_PATTERN,
    validate_seat_config,
)
from .validators import normalize_registration_number, registration_core

FACILITY_ORDER = list(BusFacility.values)
SEAT_FIELDS = ("seat_number", "row", "column", "seat_type", "is_available")


# ---------------------------------------------------------------------------
# Seat layouts
# ---------------------------------------------------------------------------
class SeatSerializer(serializers.ModelSerializer):
    class Meta:
        model = Seat
        fields = list(SEAT_FIELDS)
        extra_kwargs = {
            "row": {"min_value": 1, "max_value": MAX_LAYOUT_ROWS},
            "column": {"min_value": 1, "max_value": MAX_LAYOUT_COLUMNS},
        }

    def validate_seat_number(self, value: str) -> str:
        value = value.strip().upper()
        if not SEAT_NUMBER_PATTERN.fullmatch(value):
            raise serializers.ValidationError("Use 1–8 letters, digits or dashes.")
        return value


def _signature(seats) -> list[tuple]:
    return sorted(
        (s["row"], s["column"], s["seat_number"], s["seat_type"], s.get("is_available", True))
        for s in seats
    )


class SeatLayoutListSerializer(serializers.ModelSerializer):
    seat_count = serializers.IntegerField(read_only=True)
    bookable_seat_count = serializers.IntegerField(read_only=True)
    bus_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = SeatLayout
        fields = [
            "id",
            "name",
            "layout_type",
            "rows",
            "columns",
            "description",
            "active",
            "seat_count",
            "bookable_seat_count",
            "bus_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]
        extra_kwargs = {
            "name": {"validators": []},
            "rows": {"min_value": 1, "max_value": MAX_LAYOUT_ROWS},
            "columns": {"min_value": MIN_LAYOUT_COLUMNS, "max_value": MAX_LAYOUT_COLUMNS},
        }


class SeatLayoutSerializer(SeatLayoutListSerializer):
    """Layout with its full seat list. Writing `seats` replaces every seat atomically."""

    seats = SeatSerializer(many=True, required=False)

    class Meta(SeatLayoutListSerializer.Meta):
        fields = [*SeatLayoutListSerializer.Meta.fields, "seats"]

    def validate_name(self, value: str) -> str:
        value = " ".join(value.split())
        clash = SeatLayout.objects.filter(name__iexact=value)
        if self.instance is not None:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError("A seat layout with this name already exists.")
        return value

    def validate(self, attrs: dict) -> dict:
        instance = self.instance
        rows = attrs.get("rows", getattr(instance, "rows", None))
        columns = attrs.get("columns", getattr(instance, "columns", None))
        seats = attrs.get("seats")

        if instance is None and not seats:
            raise serializers.ValidationError({"seats": ["Add the seats for this layout."]})
        if seats is None:
            if "rows" not in attrs and "columns" not in attrs:
                return attrs
            seats_to_check = list(instance.seats.values(*SEAT_FIELDS))
        else:
            seats_to_check = seats

        errors = validate_seat_config(rows, columns, seats_to_check)
        if errors:
            raise serializers.ValidationError({"seats": errors})

        if seats is not None:
            for seat in seats:
                if seat["seat_type"] in CREW_SEAT_TYPES:
                    seat["is_available"] = False  # crew seats are never sold
            if instance is not None:
                self._check_assigned_buses(instance, seats)
        return attrs

    @staticmethod
    def _check_assigned_buses(layout: SeatLayout, seats: list[dict]) -> None:
        bookable = sum(
            1
            for s in seats
            if s["seat_type"] in BOOKABLE_SEAT_TYPES and s.get("is_available", True)
        )
        too_large = layout.buses.filter(seat_capacity__gt=bookable).values_list(
            "registration_number", "seat_capacity"
        )
        problems = [
            f"Bus {registration} sells {capacity} seats, but this layout would only have "
            f"{bookable} bookable seats."
            for registration, capacity in too_large
        ]
        if problems:
            raise serializers.ValidationError({"seats": problems})

    @transaction.atomic
    def create(self, validated_data: dict) -> SeatLayout:
        seats = validated_data.pop("seats")
        layout = SeatLayout.objects.create(**validated_data)
        Seat.objects.bulk_create(Seat(layout=layout, **seat) for seat in seats)
        return layout

    @transaction.atomic
    def update(self, instance: SeatLayout, validated_data: dict) -> SeatLayout:
        seats = validated_data.pop("seats", None)
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save()
        if seats is not None and _signature(seats) != _signature(
            instance.seats.values(*SEAT_FIELDS)
        ):
            instance.seats.all().delete()
            Seat.objects.bulk_create(Seat(layout=instance, **seat) for seat in seats)
            self.changed_nested = ["seats"]
        return instance


class SeatLayoutGenerateSerializer(serializers.Serializer):
    layout_type = serializers.ChoiceField(
        choices=[
            (SeatLayoutType.TWO_BY_TWO.value, SeatLayoutType.TWO_BY_TWO.label),
            (SeatLayoutType.TWO_BY_ONE.value, SeatLayoutType.TWO_BY_ONE.label),
        ]
    )
    passenger_rows = serializers.IntegerField(
        min_value=MIN_PASSENGER_ROWS, max_value=MAX_PASSENGER_ROWS
    )
    back_row_full = serializers.BooleanField(default=True)
    conductor_seat = serializers.BooleanField(default=True)


# ---------------------------------------------------------------------------
# Buses
# ---------------------------------------------------------------------------
class AdminBusSerializer(serializers.ModelSerializer):
    operator_name = serializers.CharField(source="operator.company_name", read_only=True)
    seat_layout_name = serializers.CharField(
        source="seat_layout.name", read_only=True, default=None
    )
    facilities = serializers.ListField(
        child=serializers.ChoiceField(choices=BusFacility.choices), required=False
    )
    trip_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Bus
        fields = [
            "id",
            "operator",
            "operator_name",
            "registration_number",
            "name",
            "bus_type",
            "seat_capacity",
            "seat_layout",
            "seat_layout_name",
            "facilities",
            "active",
            "trip_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]
        extra_kwargs = {
            # Uniqueness is checked on the *normalised* plate in validate_registration_number.
            "registration_number": {"validators": []},
            "seat_capacity": {"min_value": 1, "max_value": MAX_SEAT_CAPACITY},
        }

    def validate_registration_number(self, value: str) -> str:
        try:
            canonical = normalize_registration_number(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.messages) from exc
        core = registration_core(canonical)
        clash = Bus.objects.filter(
            Q(registration_number=core) | Q(registration_number__endswith=f" {core}")
        ).select_related("operator")
        if self.instance is not None:
            clash = clash.exclude(pk=self.instance.pk)
        existing = clash.first()
        if existing:
            raise serializers.ValidationError(
                f"{existing.registration_number} is already registered to "
                f"{existing.operator.company_name}."
            )
        return canonical

    def validate_name(self, value: str) -> str:
        value = " ".join(value.split())
        if len(value) < 2:
            raise serializers.ValidationError("Enter a name for this bus.")
        return value

    def validate_facilities(self, value: list[str]) -> list[str]:
        chosen = set(value)
        return [facility for facility in FACILITY_ORDER if facility in chosen]

    def validate_operator(self, operator):
        changing = self.instance is None or self.instance.operator_id != operator.pk
        if changing and operator.status == OperatorStatus.SUSPENDED:
            raise serializers.ValidationError(
                "This operator is suspended. Activate it before assigning buses."
            )
        return operator

    def validate_seat_layout(self, layout):
        changing = self.instance is None or self.instance.seat_layout_id != getattr(
            layout, "pk", None
        )
        if layout is not None and changing and not layout.active:
            raise serializers.ValidationError("This seat layout is inactive.")
        return layout

    def validate(self, attrs: dict) -> dict:
        instance = self.instance
        bus_type = attrs.get("bus_type", getattr(instance, "bus_type", None))
        facilities = attrs.get("facilities", list(getattr(instance, "facilities", [])))
        if bus_type in AIR_CONDITIONED_BUS_TYPES and BusFacility.AC not in facilities:
            chosen = {*facilities, BusFacility.AC.value}
            attrs["facilities"] = [f for f in FACILITY_ORDER if f in chosen]

        layout = attrs.get("seat_layout", getattr(instance, "seat_layout", None))
        capacity = attrs.get("seat_capacity", getattr(instance, "seat_capacity", None))
        if layout is not None and capacity is not None:
            bookable = layout.bookable_seat_count()
            if capacity > bookable:
                raise serializers.ValidationError(
                    {
                        "seat_capacity": [
                            f"The “{layout.name}” layout only has {bookable} bookable seats."
                        ]
                    }
                )
        if instance is not None and capacity is not None and capacity < instance.seat_capacity:
            booked = self._most_seats_booked_on_upcoming_trips(instance)
            if capacity < booked:
                raise serializers.ValidationError(
                    {
                        "seat_capacity": [
                            f"An upcoming trip on this bus already has {booked} seats booked."
                        ]
                    }
                )
        return attrs

    @staticmethod
    def _most_seats_booked_on_upcoming_trips(bus: Bus) -> int:
        upcoming = with_availability(
            Trip.objects.filter(
                bus=bus, status__in=OPEN_TRIP_STATUSES, departure_datetime__gt=timezone.now()
            )
        )
        return max(upcoming.values_list("booked_seats", flat=True), default=0)

    @transaction.atomic
    def update(self, instance: Bus, validated_data: dict) -> Bus:
        previous_operator = instance.operator_id
        bus = super().update(instance, validated_data)
        if bus.operator_id != previous_operator:
            # Journeys that haven't left yet, and the bus's timetables, move with the bus.
            # Departed / completed / cancelled trips keep their historical operator.
            Trip.objects.filter(bus=bus, status__in=OPEN_TRIP_STATUSES).update(
                operator=bus.operator
            )
            TripSchedule.objects.filter(bus=bus).update(operator=bus.operator)
        return bus
