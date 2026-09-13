from datetime import timedelta

from rest_framework import serializers

from .models import Route, RouteStop, Stop
from .routing import POLYLINE_PRECISION


def _minutes(value: timedelta | None) -> int | None:
    return None if value is None else int(value.total_seconds() // 60)


class RoadPathSerializer(serializers.Serializer):
    """
    The road the bus drives, as an encoded polyline.

    Null until a routing service has worked it out — the map then falls back to straight lines
    between the stops, which is obviously approximate rather than quietly wrong.
    """

    geometry = serializers.CharField(read_only=True)
    precision = serializers.IntegerField(read_only=True)
    distance_m = serializers.IntegerField(read_only=True)
    duration_s = serializers.IntegerField(read_only=True)
    source = serializers.CharField(read_only=True)
    updated_at = serializers.DateTimeField(read_only=True)


def road_path_of(route) -> dict | None:
    """The stored road path in the shape the API publishes it, or None when there is not one."""
    if not route.path:
        return None
    return {
        "geometry": route.path,
        "precision": POLYLINE_PRECISION,
        "distance_m": route.path_distance_m,
        "duration_s": route.path_duration_s,
        "source": route.path_source,
        "updated_at": route.path_updated_at,
    }


class StopSerializer(serializers.ModelSerializer):
    class Meta:
        model = Stop
        fields = ["id", "name", "city", "latitude", "longitude"]
        read_only_fields = fields


class RouteStopSerializer(serializers.ModelSerializer):
    stop = StopSerializer(read_only=True)
    arrival_offset_minutes = serializers.SerializerMethodField()
    departure_offset_minutes = serializers.SerializerMethodField()

    class Meta:
        model = RouteStop
        fields = [
            "sequence",
            "stop",
            "arrival_offset_minutes",
            "departure_offset_minutes",
            "is_boarding_point",
            "is_dropoff_point",
        ]
        read_only_fields = fields

    def get_arrival_offset_minutes(self, obj: RouteStop) -> int:
        return _minutes(obj.arrival_offset) or 0

    def get_departure_offset_minutes(self, obj: RouteStop) -> int:
        return _minutes(obj.departure_offset) or 0


class RouteSerializer(serializers.ModelSerializer):
    origin = StopSerializer(read_only=True)
    destination = StopSerializer(read_only=True)
    duration_minutes = serializers.SerializerMethodField()
    stop_count = serializers.IntegerField(read_only=True)
    starting_fare = serializers.DecimalField(
        max_digits=10, decimal_places=2, read_only=True, allow_null=True
    )

    class Meta:
        model = Route
        fields = [
            "id",
            "name",
            "route_number",
            "origin",
            "destination",
            "description",
            "duration_minutes",
            "stop_count",
            "starting_fare",
        ]
        read_only_fields = fields

    def get_duration_minutes(self, obj: Route) -> int | None:
        return _minutes(getattr(obj, "journey_duration", None))


class RouteDetailSerializer(RouteSerializer):
    stops = RouteStopSerializer(source="route_stops", many=True, read_only=True)

    class Meta(RouteSerializer.Meta):
        fields = [*RouteSerializer.Meta.fields, "stops"]
        read_only_fields = fields
