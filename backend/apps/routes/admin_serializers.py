from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from .models import Route, Stop
from .serializers import RoadPathSerializer, road_path_of
from .services import (
    MAX_OFFSET_MINUTES,
    clear_route_path,
    refresh_route_path,
    replace_route_stops,
    validate_route_stops,
)

MAX_BASE_FARE = Decimal("100000")


# ---------------------------------------------------------------------------
# Stops
# ---------------------------------------------------------------------------
class AdminStopSerializer(serializers.ModelSerializer):
    route_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Stop
        fields = [
            "id",
            "name",
            "city",
            "latitude",
            "longitude",
            "active",
            "route_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]
        extra_kwargs = {
            "latitude": {"min_value": Decimal("-90"), "max_value": Decimal("90")},
            "longitude": {"min_value": Decimal("-180"), "max_value": Decimal("180")},
        }

    @staticmethod
    def _clean_text(value: str, label: str) -> str:
        value = " ".join(value.split())
        if len(value) < 2:
            raise serializers.ValidationError(f"Enter the {label}.")
        return value

    def validate_name(self, value: str) -> str:
        return self._clean_text(value, "stop name")

    def validate_city(self, value: str) -> str:
        return self._clean_text(value, "city")

    def validate(self, attrs: dict) -> dict:
        instance = self.instance
        latitude = attrs.get("latitude", getattr(instance, "latitude", None))
        longitude = attrs.get("longitude", getattr(instance, "longitude", None))
        if (latitude is None) != (longitude is None):
            field = "longitude" if longitude is None else "latitude"
            raise serializers.ValidationError(
                {field: ["Enter both latitude and longitude, or leave both empty."]}
            )

        name = attrs.get("name", getattr(instance, "name", ""))
        city = attrs.get("city", getattr(instance, "city", ""))
        clash = Stop.objects.filter(name__iexact=name, city__iexact=city)
        if instance is not None:
            clash = clash.exclude(pk=instance.pk)
        if clash.exists():
            raise serializers.ValidationError(
                {"name": [f"A stop called “{name}” already exists in {city}."]}
            )
        return attrs


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
class StopBriefSerializer(serializers.ModelSerializer):
    """Enough to name a stop and put it on a map."""

    class Meta:
        model = Stop
        fields = ["id", "name", "city", "active", "latitude", "longitude"]
        read_only_fields = fields


class StopReferenceField(serializers.PrimaryKeyRelatedField):
    """Accepts a stop id on write; renders the stop's summary on read."""

    def use_pk_only_optimization(self) -> bool:
        return False

    def to_representation(self, value: Stop) -> dict:
        return StopBriefSerializer(value).data


class OffsetMinutesField(serializers.IntegerField):
    """Minutes after departure. Stored as a DurationField, exchanged as whole minutes."""

    def to_representation(self, value) -> int:
        if isinstance(value, timedelta):
            return int(value.total_seconds() // 60)
        return int(value)


class AdminRouteStopSerializer(serializers.Serializer):
    sequence = serializers.IntegerField(read_only=True)
    stop = StopReferenceField(queryset=Stop.objects.all())
    arrival_offset_minutes = OffsetMinutesField(
        source="arrival_offset", min_value=0, max_value=MAX_OFFSET_MINUTES
    )
    departure_offset_minutes = OffsetMinutesField(
        source="departure_offset", min_value=0, max_value=MAX_OFFSET_MINUTES
    )
    is_boarding_point = serializers.BooleanField(default=True)
    is_dropoff_point = serializers.BooleanField(default=True)


class AdminRouteListSerializer(serializers.ModelSerializer):
    origin = StopBriefSerializer(read_only=True)
    destination = StopBriefSerializer(read_only=True)
    stop_count = serializers.IntegerField(read_only=True)
    duration_minutes = serializers.SerializerMethodField()
    trip_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Route
        fields = [
            "id",
            "name",
            "route_number",
            "description",
            "base_fare",
            "active",
            "origin",
            "destination",
            "stop_count",
            "duration_minutes",
            "trip_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]
        extra_kwargs = {
            "base_fare": {"min_value": Decimal("0"), "max_value": MAX_BASE_FARE},
        }

    def get_duration_minutes(self, route: Route) -> int | None:
        duration = getattr(route, "journey_duration", None)
        return None if duration is None else int(duration.total_seconds() // 60)


class AdminRouteSerializer(AdminRouteListSerializer):
    """
    Route with its ordered stops. Writing `stops` replaces the whole list; origin and
    destination are taken from the first and last stop.
    """

    stops = AdminRouteStopSerializer(many=True, source="route_stops", required=False)
    road_path = serializers.SerializerMethodField()

    class Meta(AdminRouteListSerializer.Meta):
        fields = [*AdminRouteListSerializer.Meta.fields, "stops", "road_path"]

    @extend_schema_field(RoadPathSerializer)
    def get_road_path(self, route: Route) -> dict | None:
        """The road the bus drives, once a routing service has worked it out."""
        return road_path_of(route)

    def validate_name(self, value: str) -> str:
        value = " ".join(value.split())
        if len(value) < 3:
            raise serializers.ValidationError("Enter a route name, e.g. Colombo – Kandy.")
        return value

    def validate_route_number(self, value: str) -> str:
        return " ".join(value.upper().split())

    def validate_description(self, value: str) -> str:
        return value.strip()

    def validate(self, attrs: dict) -> dict:
        entries = attrs.get("route_stops")
        if self.instance is None and entries is None:
            raise serializers.ValidationError({"stops": ["Add the stops for this route."]})
        if entries is not None:
            errors = validate_route_stops(entries)
            if errors:
                raise serializers.ValidationError({"stops": errors})
            attrs["origin"] = entries[0]["stop"]
            attrs["destination"] = entries[-1]["stop"]
        return attrs

    @transaction.atomic
    def create(self, validated_data: dict) -> Route:
        entries = validated_data.pop("route_stops")
        route = Route.objects.create(**validated_data)
        replace_route_stops(route, entries)
        transaction.on_commit(lambda: refresh_route_path(route))
        return route

    @transaction.atomic
    def update(self, instance: Route, validated_data: dict) -> Route:
        entries = validated_data.pop("route_stops", None)
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save()
        if entries is not None and replace_route_stops(instance, entries):
            self.changed_nested = ["stops"]
            # The stored road belongs to the old stop list: drop it now, and fetch the new one
            # once the change is safely committed.
            clear_route_path(instance)
            transaction.on_commit(lambda: refresh_route_path(instance))
        return instance
