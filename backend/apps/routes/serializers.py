from datetime import timedelta

from rest_framework import serializers

from .models import Route, RouteStop, Stop


def _minutes(value: timedelta | None) -> int | None:
    return None if value is None else int(value.total_seconds() // 60)


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
